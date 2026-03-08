import { BaseAgentOptions } from "../agents/base-agent";
import { WorkerAgent, WorkerAgentResult, WorkerTask } from "../agents/worker-agent";

export interface SubTask extends WorkerTask {
  estimatedComplexity: number;
}

export interface AgentResult extends WorkerAgentResult {}

export interface FinalAnswer {
  summary: string;
  strategy: "single-agent" | "multi-agent";
  taskCount: number;
  results: AgentResult[];
}

export interface OrchestratorOptions extends BaseAgentOptions {
  complexityThreshold?: number;
  maxConcurrentAgents?: number;
}

export class Orchestrator {
  private readonly workerAgent: WorkerAgent;
  private readonly complexityThreshold: number;
  private readonly maxConcurrentAgents: number;

  constructor(options: OrchestratorOptions) {
    this.workerAgent = new WorkerAgent(options);
    this.complexityThreshold = options.complexityThreshold ?? 6;
    this.maxConcurrentAgents = Math.max(1, options.maxConcurrentAgents ?? 3);
  }

  async planAndDecompose(goal: string): Promise<SubTask[]> {
    const complexity = this.scoreComplexity(goal);

    if (complexity <= this.complexityThreshold) {
      return [
        {
          id: "task-1",
          title: "Complete user goal",
          instructions: goal,
          domain: this.inferPrimaryDomain(goal),
          requiresExternalAction: this.countExternalActions(goal) > 0,
          estimatedComplexity: complexity,
        },
      ];
    }

    const segments = goal
      .split(/(?:\.|\n|\band\b|\bthen\b)/i)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const uniqueSegments = segments.length > 1 ? segments : [goal];

    return uniqueSegments.map((segment, index) => ({
      id: `task-${index + 1}`,
      title: `Sub-task ${index + 1}`,
      instructions: segment,
      domain: this.inferPrimaryDomain(segment),
      requiresExternalAction: this.countExternalActions(segment) > 0,
      estimatedComplexity: this.scoreComplexity(segment),
    }));
  }

  async spawnAgent(task: SubTask): Promise<AgentResult> {
    return this.workerAgent.execute(task);
  }

  async mergeResults(results: AgentResult[]): Promise<FinalAnswer> {
    const strategy: FinalAnswer["strategy"] = results.length > 1 ? "multi-agent" : "single-agent";
    const summary = results
      .map((result, index) => `(${index + 1}) [${result.domain}] ${result.output}`)
      .join("\n\n");

    return {
      summary,
      strategy,
      taskCount: results.length,
      results,
    };
  }

  async executeGoal(goal: string): Promise<FinalAnswer> {
    const tasks = await this.planAndDecompose(goal);

    if (tasks.length === 1) {
      const singleResult = await this.spawnAgent(tasks[0]);
      return this.mergeResults([singleResult]);
    }

    const results = await this.runWithConcurrencyLimit(tasks, this.maxConcurrentAgents);
    return this.mergeResults(results);
  }

  private async runWithConcurrencyLimit(tasks: SubTask[], maxConcurrent: number): Promise<AgentResult[]> {
    const queue = [...tasks];
    const results: AgentResult[] = [];
    const workers = Array.from({ length: Math.min(maxConcurrent, tasks.length) }, async () => {
      while (queue.length > 0) {
        const nextTask = queue.shift();
        if (!nextTask) {
          return;
        }
        const result = await this.spawnAgent(nextTask);
        results.push(result);
      }
    });

    await Promise.all(workers);

    return results;
  }

  private scoreComplexity(goal: string): number {
    const domainCount = this.countDomains(goal);
    const externalActionCount = this.countExternalActions(goal);
    const lengthScore = goal.length > 180 ? 2 : goal.length > 80 ? 1 : 0;

    return domainCount * 2 + externalActionCount * 2 + lengthScore;
  }

  private countDomains(goal: string): number {
    const domainPatterns: Record<string, RegExp> = {
      engineering: /code|api|typescript|architecture|bug|refactor/i,
      research: /research|analyze|compare|summarize|sources?/i,
      operations: /deploy|infrastructure|kubernetes|docker|monitoring/i,
      product: /roadmap|customer|market|pricing|feature/i,
      legal: /legal|compliance|policy|regulation|contract/i,
      finance: /budget|financial|revenue|cost|forecast/i,
    };

    return Object.values(domainPatterns).filter((pattern) => pattern.test(goal)).length;
  }

  private countExternalActions(goal: string): number {
    const actionPattern = /call|fetch|query|search|email|upload|download|integrate|post|send/i;
    const matches = goal.match(new RegExp(actionPattern.source, "gi"));
    return matches?.length ?? 0;
  }

  private inferPrimaryDomain(goal: string): string {
    if (/api|code|typescript|bug|refactor/i.test(goal)) {
      return "engineering";
    }
    if (/research|analyze|compare|summarize/i.test(goal)) {
      return "research";
    }
    if (/deploy|docker|kubernetes|monitoring/i.test(goal)) {
      return "operations";
    }
    return "general";
  }
}
