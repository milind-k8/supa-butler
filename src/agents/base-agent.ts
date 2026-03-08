import Anthropic from "@anthropic-ai/sdk";

export interface BaseAgentOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AgentRunParams {
  task: string;
  context?: string;
}

export class BaseAgent {
  protected readonly client: Anthropic;
  protected readonly model: string;
  protected readonly maxTokens: number;
  protected readonly temperature: number;
  protected readonly systemPrompt: string;

  constructor(options: BaseAgentOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? "claude-3-5-sonnet-latest";
    this.maxTokens = options.maxTokens ?? 1024;
    this.temperature = options.temperature ?? 0.2;
    this.systemPrompt = options.systemPrompt ?? "You are a precise task execution agent.";
  }

  async run(params: AgentRunParams): Promise<string> {
    const prompt = [params.task, params.context].filter(Boolean).join("\n\n");

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      system: this.systemPrompt,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const textContent = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return textContent;
  }
}
