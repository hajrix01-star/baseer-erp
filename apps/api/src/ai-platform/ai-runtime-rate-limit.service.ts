import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";

type RuntimeWindow = { requestCount: number; windowEndsAt: number };

/**
 * Gate B is deliberately provider-offline, but preflight still writes receipts.
 * Bound it before a user-facing surface is enabled so unique idempotency keys
 * cannot turn it into an audit/receipt flood.
 */
@Injectable()
export class AiRuntimeRateLimitService {
  private readonly windows = new Map<string, RuntimeWindow>();
  private readonly maxRequests = 30;
  private readonly windowMs = 5 * 60 * 1_000;

  recordNewExecution(context: TrustedCompanyActorContext): void {
    const now = Date.now();
    const key = `${context.tenantId}:${context.companyId}:${context.actorUserId}`;
    const prior = this.windows.get(key);
    const window = !prior || prior.windowEndsAt <= now
      ? { requestCount: 0, windowEndsAt: now + this.windowMs }
      : prior;
    if (window.requestCount >= this.maxRequests) {
      throw new HttpException("Too many AI runtime requests.", HttpStatus.TOO_MANY_REQUESTS);
    }
    window.requestCount += 1;
    this.windows.set(key, window);
  }
}