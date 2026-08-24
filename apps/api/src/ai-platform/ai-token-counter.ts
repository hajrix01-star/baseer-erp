import { isWithinTokenLimit } from "gpt-tokenizer/model/gpt-5-mini";

/** The configured S2 model and BPE encoding are intentionally code-owned. */
export const BASIRA_S2_TOKENIZER_MODEL = "gpt-5-mini";
export const BASIRA_S2_TOKENIZER_VERSION = "gpt-tokenizer@4.0.0/gpt-5-mini";

export type LocalTokenCount = Readonly<{
  contentTokens: number | null;
  estimatedTokens: number;
  exceedsLimit: boolean;
}>;

/**
 * Counts the exact BPE tokens of the strings Baseer sends to the provider.
 * A small fixed margin covers transport and response-schema framing which the
 * public tokenizer cannot reproduce byte-for-byte. `isWithinTokenLimit` stops
 * as soon as it proves the cap is exceeded and avoids allocating a full token
 * array for rejected oversized evidence.
 */
export function countBasiraS2InputTokens(input: Readonly<{
  model: string;
  text: string;
  maxInputTokens: number;
  safetyMarginTokens: number;
}>): LocalTokenCount {
  if (input.model !== BASIRA_S2_TOKENIZER_MODEL) {
    throw new Error(`No approved local tokenizer exists for Basira model ${input.model}.`);
  }
  if (!Number.isSafeInteger(input.maxInputTokens) || !Number.isSafeInteger(input.safetyMarginTokens) || input.maxInputTokens <= input.safetyMarginTokens) {
    throw new Error("Basira token-counter limits are invalid.");
  }
  const contentBudget = input.maxInputTokens - input.safetyMarginTokens;
  const contentTokens = isWithinTokenLimit(input.text, contentBudget);
  if (contentTokens === false) {
    return { contentTokens: null, estimatedTokens: input.maxInputTokens + 1, exceedsLimit: true };
  }
  return {
    contentTokens,
    estimatedTokens: contentTokens + input.safetyMarginTokens,
    exceedsLimit: false,
  };
}
