import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { CompactionConfig, defaultCompactionConfig } from "../config";

export type Role = "system" | "user" | "assistant" | "tool";

export interface SessionTurn {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
}

export interface MemoryChunk {
  id: string;
  createdAt: string;
  sourceTurnIds: string[];
  summary: string;
  facts: string[];
  embeddingText: string;
  metadata: {
    turnCount: number;
    estimatedTokens: number;
  };
}

export interface CompactedSession {
  shortTerm: SessionTurn[];
  longTerm: MemoryChunk[];
}

export interface ModelContext {
  turns: SessionTurn[];
  memory: MemoryChunk[];
  estimatedTokens: number;
  trimmed: boolean;
}

type TokenEstimator = (text: string) => number;

const SESSION_COMPACT_PATH = ".supa-butler/context/session_compact.md";
const ARCHIVE_DIR = ".supa-butler/context/archive";

/**
 * Two-tier session memory manager:
 * - short-term memory stores recent raw turns
 * - long-term memory stores rolling summarized chunks with embedding-ready payloads
 */
export class SessionCompactor {
  private readonly config: CompactionConfig;
  private readonly estimateTokens: TokenEstimator;

  constructor(
    config: Partial<CompactionConfig> = {},
    estimateTokens: TokenEstimator = defaultTokenEstimator,
  ) {
    this.config = { ...defaultCompactionConfig, ...config };
    this.estimateTokens = estimateTokens;
  }

  async compact(turns: SessionTurn[]): Promise<CompactedSession> {
    const persisted = await this.readPersistedState();
    const compacted: CompactedSession = {
      shortTerm: [...turns],
      longTerm: [...persisted.longTerm],
    };

    if (turns.length > 0 && turns.length % this.config.summarizeEveryNTurns === 0) {
      const chunk = this.summarizeRecentTurns(turns);
      if (chunk) {
        compacted.longTerm.push(chunk);
        compacted.longTerm = deduplicateMemoryChunks(compacted.longTerm);

        // Keep raw short-term focused on most recent turns after rolling summarization.
        compacted.shortTerm = turns.slice(-this.config.summarizeEveryNTurns);
      }
    }

    await this.persist(compacted);
    return compacted;
  }

  /**
   * Hard token cap guard before model invocation.
   */
  buildModelContext(compacted: CompactedSession): ModelContext {
    let shortTerm = [...compacted.shortTerm];
    let longTerm = [...compacted.longTerm];

    let estimatedTokens = this.computeContextTokens(shortTerm, longTerm);
    let trimmed = false;

    while (estimatedTokens > this.config.maxContextTokens && shortTerm.length > 1) {
      shortTerm = shortTerm.slice(1);
      trimmed = true;
      estimatedTokens = this.computeContextTokens(shortTerm, longTerm);
    }

    while (estimatedTokens > this.config.maxContextTokens && longTerm.length > 1) {
      longTerm = longTerm.slice(1);
      trimmed = true;
      estimatedTokens = this.computeContextTokens(shortTerm, longTerm);
    }

    if (estimatedTokens > this.config.maxContextTokens) {
      const reduced = this.forceTrimLastTurn(shortTerm, longTerm);
      shortTerm = reduced.shortTerm;
      longTerm = reduced.longTerm;
      trimmed = true;
      estimatedTokens = this.computeContextTokens(shortTerm, longTerm);
    }

    return { turns: shortTerm, memory: longTerm, estimatedTokens, trimmed };
  }

  private computeContextTokens(turns: SessionTurn[], longTerm: MemoryChunk[]): number {
    const rawTurns = turns.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
    const memory = longTerm
      .map((chunk) => `${chunk.summary}\nFacts: ${chunk.facts.join("; ")}`)
      .join("\n");

    return this.estimateTokens(`${rawTurns}\n${memory}`);
  }

  private summarizeRecentTurns(turns: SessionTurn[]): MemoryChunk | null {
    const source = turns.slice(-this.config.summarizeEveryNTurns);
    if (source.length === 0) {
      return null;
    }

    const sourceText = source.map((turn) => `${turn.role}: ${turn.content}`).join("\n");
    const sourceTokens = this.estimateTokens(sourceText);
    const targetTokens = Math.max(24, Math.floor(sourceTokens * this.config.compressionRatioTarget));

    const candidateFacts = source
      .flatMap((turn) => splitFacts(turn.content))
      .map(normalizeFact)
      .filter(Boolean);

    const uniqueFacts = deduplicateFacts(candidateFacts);
    const summaryLines = uniqueFacts.slice(0, Math.max(1, Math.floor(targetTokens / 12)));

    const summary = summaryLines.length > 0
      ? summaryLines.map((line) => `- ${line}`).join("\n")
      : "- Session progressed without extractable stable facts.";

    return {
      id: `chunk-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sourceTurnIds: source.map((turn) => turn.id),
      summary,
      facts: uniqueFacts,
      embeddingText: `summary:\n${summary}\n\nfacts:\n${uniqueFacts.join("\n")}`,
      metadata: {
        turnCount: source.length,
        estimatedTokens: this.estimateTokens(summary),
      },
    };
  }

  private forceTrimLastTurn(shortTerm: SessionTurn[], longTerm: MemoryChunk[]): CompactedSession {
    if (shortTerm.length === 0) {
      return { shortTerm, longTerm };
    }

    const [lastTurn] = shortTerm.slice(-1);
    const maxChars = Math.max(120, Math.floor((this.config.maxContextTokens * 4) / 3));

    const clipped = {
      ...lastTurn,
      content: `${lastTurn.content.slice(0, maxChars)}…`,
    };

    return {
      shortTerm: [...shortTerm.slice(0, -1), clipped],
      longTerm,
    };
  }

  private async persist(compacted: CompactedSession): Promise<void> {
    const fullSessionPath = path.resolve(SESSION_COMPACT_PATH);
    const archiveDir = path.resolve(ARCHIVE_DIR);

    await mkdir(path.dirname(fullSessionPath), { recursive: true });
    await mkdir(archiveDir, { recursive: true });

    const previous = await tryRead(fullSessionPath);
    if (previous) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archivePath = path.join(archiveDir, `session_compact-${stamp}.md`);
      await rename(fullSessionPath, archivePath);
    }

    const markdown = this.toMarkdown(compacted);
    await writeFile(fullSessionPath, markdown, "utf8");
  }

  private async readPersistedState(): Promise<CompactedSession> {
    const existing = await tryRead(path.resolve(SESSION_COMPACT_PATH));
    if (!existing) {
      return { shortTerm: [], longTerm: [] };
    }

    // Prefer in-memory state from callers. Persisted markdown is human/audit facing.
    return { shortTerm: [], longTerm: [] };
  }

  private toMarkdown(compacted: CompactedSession): string {
    const shortTerm = compacted.shortTerm
      .map((turn) => `- [${turn.timestamp}] (${turn.role}) ${turn.content}`)
      .join("\n");

    const longTerm = compacted.longTerm
      .map((chunk) => {
        const facts = chunk.facts.map((fact) => `  - ${fact}`).join("\n");

        return [
          `### ${chunk.id}`,
          `- createdAt: ${chunk.createdAt}`,
          `- sourceTurnIds: ${chunk.sourceTurnIds.join(", ")}`,
          "- summary:",
          chunk.summary,
          "- facts:",
          facts || "  - (none)",
          "- embeddingText:",
          "```text",
          chunk.embeddingText,
          "```",
        ].join("\n");
      })
      .join("\n\n");

    return [
      "# Session Compaction",
      "",
      "## Short-term memory (raw recent turns)",
      shortTerm || "- (none)",
      "",
      "## Long-term memory (summarized chunks)",
      longTerm || "- (none)",
      "",
    ].join("\n");
  }
}

function splitFacts(content: string): string[] {
  return content
    .split(/\n|[.!?]/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function normalizeFact(fact: string): string {
  return fact.toLowerCase().replace(/\s+/g, " ").trim();
}

function deduplicateFacts(facts: string[]): string[] {
  const unique: string[] = [];

  for (const fact of facts) {
    const duplicate = unique.some((existing) => semanticSimilarity(existing, fact) >= 0.9);
    if (!duplicate) {
      unique.push(fact);
    }
  }

  return unique;
}

function deduplicateMemoryChunks(chunks: MemoryChunk[]): MemoryChunk[] {
  const out: MemoryChunk[] = [];

  for (const chunk of chunks) {
    const isDuplicate = out.some((existing) => {
      const a = existing.facts.join(" ");
      const b = chunk.facts.join(" ");
      return semanticSimilarity(a, b) >= 0.85;
    });

    if (!isDuplicate) {
      out.push(chunk);
    }
  }

  return out;
}

function semanticSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/g).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/g).filter(Boolean));

  if (tokensA.size === 0 && tokensB.size === 0) {
    return 1;
  }

  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;

  return union === 0 ? 0 : intersection / union;
}

async function tryRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function defaultTokenEstimator(text: string): number {
  return Math.ceil(text.length / 4);
}
