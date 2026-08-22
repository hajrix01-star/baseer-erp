import { createHash } from "node:crypto";

type RequestLike = {
  body?: unknown;
};

/**
 * Produces a stable, non-reversible limiter identity from one authentication
 * field. The throttler hashes its storage key too; hashing here means neither
 * an email nor a refresh token becomes a limiter tracker in process memory.
 */
function identityTracker(
  request: RequestLike,
  field: "login" | "email" | "refreshToken",
  namespace: string,
): string {
  const body = request.body;
  const value =
    body && typeof body === "object" && field in body
      ? (body as Record<string, unknown>)[field]
      : undefined;
  const normalized =
    typeof value === "string" && value.length <= 8_192
      ? value.trim().toLowerCase()
      : "invalid";
  const digest = createHash("sha256").update(normalized).digest("base64url");
  return `${namespace}:${digest}`;
}

export function signInIdentityTracker(request: RequestLike): string {
  return identityTracker(request, "login", "sign-in");
}

export function ownerActivationIdentityTracker(request: RequestLike): string {
  return identityTracker(request, "email", "owner-activation");
}

export function refreshIdentityTracker(request: RequestLike): string {
  return identityTracker(request, "refreshToken", "refresh");
}

/** Fifteen minutes in milliseconds; the API receipt and Retry-After agree. */
export const AUTH_THROTTLE_WINDOW_MS = 15 * 60 * 1_000;
