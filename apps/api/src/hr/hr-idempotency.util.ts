import { ConflictException } from '@nestjs/common';

/**
 * Rehydrates a completed HR command receipt for an idempotent replay.
 * Stored receipts intentionally record `replayed: false`; callers must never
 * expose that original flag on a replay because post-commit cleanup depends on
 * the replay marker (notably encrypted employee-document uploads).
 */
export function hrReplayReceipt<T extends { replayed: boolean }>(body: unknown): T {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ConflictException('The stored HR idempotency receipt is invalid.');
  }

  return { ...body, replayed: true } as T;
}
