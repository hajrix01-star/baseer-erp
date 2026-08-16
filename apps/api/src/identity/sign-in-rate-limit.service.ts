import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

type AttemptWindow = {
  failedAttempts: number;
  windowEndsAt: number;
  blockedUntil: number | null;
};

/**
 * Small in-process guard for the private, single-server deployment. It is not
 * a replacement for edge protection; a distributed limit can be added with a
 * shared store if BASEER ERP is ever scaled beyond one API process.
 */
@Injectable()
export class SignInRateLimitService {
  private readonly attempts = new Map<string, AttemptWindow>();
  private readonly maxFailures = 5;
  private readonly windowMs = 15 * 60 * 1_000;
  private readonly blockMs = 15 * 60 * 1_000;

  assertAllowed(key: string): void {
    const now = Date.now();
    const current = this.attempts.get(key);
    if (!current) return;
    if (current.blockedUntil && current.blockedUntil > now) {
      throw new HttpException("Too many sign-in attempts.", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (current.windowEndsAt <= now) this.attempts.delete(key);
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const prior = this.attempts.get(key);
    const current = !prior || prior.windowEndsAt <= now
      ? { failedAttempts: 0, windowEndsAt: now + this.windowMs, blockedUntil: null }
      : prior;
    current.failedAttempts += 1;
    if (current.failedAttempts >= this.maxFailures) current.blockedUntil = now + this.blockMs;
    this.attempts.set(key, current);
  }

  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  key(tenantCode: string, login: string): string {
    return `${tenantCode.normalize("NFKC").trim().toLowerCase()}:${login.normalize("NFKC").trim().toLowerCase()}`;
  }
}