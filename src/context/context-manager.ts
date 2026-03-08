import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type FrontmatterValue = string | number | boolean;

export interface ContextMetadata {
  timestamp?: string;
  source?: string;
  confidence?: number;
  [key: string]: FrontmatterValue | undefined;
}

export interface MemoryEntry {
  content: string;
  source?: string;
  confidence?: number;
  timestamp?: string;
}

export interface UserProfileUpdate {
  profile: string;
  source?: string;
  confidence?: number;
  timestamp?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  usage?: string;
  source?: string;
  confidence?: number;
  timestamp?: string;
}

export interface SessionSnapshot {
  summary: string;
  source?: string;
  confidence?: number;
  timestamp?: string;
}

const CONTEXT_DIR = ".supa-butler/context";

const CANONICAL_FILES = {
  tools: "tools.md",
  users: "users.md",
  memory: "memory.md",
  session: "session.md",
} as const;

export class ContextManager {
  private readonly baseDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.baseDir = path.join(rootDir, CONTEXT_DIR);
  }

  async appendMemory(entry: MemoryEntry): Promise<void> {
    const section = this.buildSection(
      entry.content,
      this.buildMetadata({
        source: entry.source,
        confidence: entry.confidence,
        timestamp: entry.timestamp,
      }),
      "memory-entry",
    );

    await this.appendToCanonicalFile(CANONICAL_FILES.memory, section);
  }

  async upsertUserProfile(userId: string, data: UserProfileUpdate): Promise<void> {
    const usersPath = this.resolveCanonicalPath(CANONICAL_FILES.users);
    await this.ensureContextDirectory();

    const existing = await this.readOrEmpty(usersPath);
    const blockPattern = new RegExp(`## User: ${this.escapeRegExp(userId)}\\n[\\s\\S]*?(?=\\n## User: |$)`, "m");

    const section = [
      `## User: ${userId}`,
      this.buildSection(
        data.profile,
        this.buildMetadata({
          source: data.source,
          confidence: data.confidence,
          timestamp: data.timestamp,
        }),
        "user-profile",
      ),
    ].join("\n");

    const nextContent = blockPattern.test(existing)
      ? existing.replace(blockPattern, section)
      : this.joinMarkdown(existing, section);

    await writeFile(usersPath, `${nextContent.trimEnd()}\n`, "utf8");
  }

  async registerTool(toolDef: ToolDefinition): Promise<void> {
    const content = [
      `### ${toolDef.name}`,
      toolDef.description.trim(),
      toolDef.usage ? `\n**Usage**\n\n\`\`\`\n${toolDef.usage.trim()}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const section = this.buildSection(
      content,
      this.buildMetadata({
        source: toolDef.source,
        confidence: toolDef.confidence,
        timestamp: toolDef.timestamp,
      }),
      "tool-definition",
    );

    await this.appendToCanonicalFile(CANONICAL_FILES.tools, section);
  }

  async snapshotSession(summary: SessionSnapshot | string): Promise<void> {
    const payload: SessionSnapshot =
      typeof summary === "string"
        ? { summary }
        : summary;

    const section = this.buildSection(
      payload.summary,
      this.buildMetadata({
        source: payload.source,
        confidence: payload.confidence,
        timestamp: payload.timestamp,
      }),
      "session-snapshot",
    );

    await this.appendToCanonicalFile(CANONICAL_FILES.session, section);
  }

  private async appendToCanonicalFile(fileName: string, section: string): Promise<void> {
    await this.ensureContextDirectory();
    const filePath = this.resolveCanonicalPath(fileName);
    const existing = await this.readOrEmpty(filePath);
    const next = this.joinMarkdown(existing, section);
    await writeFile(filePath, `${next.trimEnd()}\n`, "utf8");
  }

  private resolveCanonicalPath(fileName: string): string {
    return path.join(this.baseDir, fileName);
  }

  private async ensureContextDirectory(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  private async readOrEmpty(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }

      throw error;
    }
  }

  private buildMetadata(metadata: ContextMetadata): ContextMetadata {
    return {
      timestamp: metadata.timestamp ?? new Date().toISOString(),
      source: metadata.source ?? "supa-butler",
      confidence: metadata.confidence ?? 0.8,
    };
  }

  private buildSection(body: string, metadata: ContextMetadata, heading: string): string {
    const frontmatter = this.formatFrontmatter(metadata);
    return [`## ${heading}`, frontmatter, body.trim()].join("\n\n");
  }

  private formatFrontmatter(metadata: ContextMetadata): string {
    const rows = Object.entries(metadata)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${this.serializeFrontmatterValue(value as FrontmatterValue)}`);

    return ["---", ...rows, "---"].join("\n");
  }

  private serializeFrontmatterValue(value: FrontmatterValue): string {
    if (typeof value === "string") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private joinMarkdown(existing: string, incoming: string): string {
    const trimmedExisting = existing.trimEnd();
    const trimmedIncoming = incoming.trim();

    if (!trimmedExisting) {
      return trimmedIncoming;
    }

    return `${trimmedExisting}\n\n${trimmedIncoming}`;
  }

  private escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
