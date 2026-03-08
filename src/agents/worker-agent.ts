import { AgentRunParams, BaseAgent, BaseAgentOptions } from "./base-agent";

export interface WorkerTask {
  id: string;
  title: string;
  instructions: string;
  domain: string;
  requiresExternalAction?: boolean;
}

export interface WorkerAgentResult {
  taskId: string;
  domain: string;
  output: string;
}

export class WorkerAgent extends BaseAgent {
  constructor(options: BaseAgentOptions) {
    super({
      ...options,
      systemPrompt:
        options.systemPrompt ??
        "You are a specialist worker agent. Complete only the assigned sub-task and return concise, factual output.",
    });
  }

  async execute(task: WorkerTask, context?: string): Promise<WorkerAgentResult> {
    const params: AgentRunParams = {
      task: [
        `Task ID: ${task.id}`,
        `Title: ${task.title}`,
        `Domain: ${task.domain}`,
        "Instructions:",
        task.instructions,
      ].join("\n"),
      context,
    };

    const output = await this.run(params);

    return {
      taskId: task.id,
      domain: task.domain,
      output,
    };
  }
}
