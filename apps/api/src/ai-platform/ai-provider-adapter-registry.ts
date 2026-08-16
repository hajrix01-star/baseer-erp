import { Injectable } from "@nestjs/common";

import type { AiProviderKind } from "../generated/prisma/client.js";

export type AiProviderAdapterResult = Readonly<{
  outcome: "BLOCKED";
  safeReasonCode: "AI_PROVIDER_EXECUTION_DISABLED";
}>;

/**
 * The only future route to a model provider. Gate B intentionally registers no
 * network adapter: callers receive a deterministic blocked result instead of a
 * hidden fallback or an accidental external request.
 */
@Injectable()
export class AiProviderAdapterRegistry {
  offlineResult(_provider: AiProviderKind | null): AiProviderAdapterResult {
    return {
      outcome: "BLOCKED",
      safeReasonCode: "AI_PROVIDER_EXECUTION_DISABLED",
    };
  }
}