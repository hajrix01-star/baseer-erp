/**
 * Minimal provider metering captured with a generated response. These values
 * are operational metadata, never part of Basira's explanation payload.
 */
export type AiProviderUsage = Readonly<{
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
}>;

export type AiProviderGeneratedResult<T> = Readonly<{
  output: T;
  usage: AiProviderUsage;
}>;
