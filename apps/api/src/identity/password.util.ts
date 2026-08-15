import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';

const BCRYPT_COST = 12;
const BCRYPT_HASH = /^\$2[aby]\$(?:0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}$/;

/** Produces a bcrypt hash compatible with migrated Noorix credentials. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verifies only the bcrypt formats used by Noorix ($2a$, $2b$, and $2y$).
 * bcryptjs performs the work locally and nothing here logs password material.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    if (!BCRYPT_HASH.test(storedHash)) {
      return false;
    }

    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

/** A fixed-length one-way hash for the server-side refresh-token allow-list. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function verifyRefreshTokenHash(token: string, expectedHash: string): boolean {
  const actualHash = Buffer.from(hashRefreshToken(token), 'base64url');
  const storedHash = Buffer.from(expectedHash, 'base64url');

  return (
    actualHash.length === storedHash.length &&
    timingSafeEqual(actualHash, storedHash)
  );
}
