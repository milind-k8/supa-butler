export interface CompactionConfig {
  /**
   * Absolute upper token boundary for the prompt context before a model call.
   */
  maxContextTokens: number;

  /**
   * Number of new turns between rolling summarization passes.
   */
  summarizeEveryNTurns: number;

  /**
   * Approximate target ratio between summarized output and source turns.
   * Example: 0.35 keeps summaries around 35% of source size.
   */
  compressionRatioTarget: number;
}

export const defaultCompactionConfig: CompactionConfig = {
  maxContextTokens: 8_000,
  summarizeEveryNTurns: 6,
  compressionRatioTarget: 0.35,
};
