import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type IdentityTokenType = 'access' | 'refresh';

/** The complete payload accepted by the identity boundary. */
export interface IdentityTokenClaims {
  jti: string;
  sessionId: string;
  userId: string;
  tenantId: string;
  sessionVersion: number;
  tokenType: IdentityTokenType;
  exp: number;
}

export interface IssuedIdentityToken {
  token: string;
  claims: IdentityTokenClaims;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MINIMUM_SECRET_BYTES = 32;
const TOKEN_HEADER = { alg: 'HS256', typ: 'JWT' } as const;
const CLAIM_KEYS = [
  'exp',
  'jti',
  'sessionId',
  'sessionVersion',
  'tenantId',
  'tokenType',
  'userId',
] as const;

export class IdentityTokenError extends Error {
  constructor() {
    super('Invalid identity token.');
  }
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new IdentityTokenError();
  }

  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    throw new IdentityTokenError();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTtl(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 365 * 24 * 60 * 60) {
    throw new Error(`${name} must be a positive number of seconds up to one year.`);
  }

  return value;
}

@Injectable()
export class IdentityTokenService {
  issueAccess(input: Omit<IdentityTokenClaims, 'tokenType' | 'exp' | 'jti'>): IssuedIdentityToken {
    return this.issue(input, 'access', readTtl('IDENTITY_ACCESS_TOKEN_TTL_SECONDS', ACCESS_TOKEN_TTL_SECONDS));
  }

  issueRefresh(input: Omit<IdentityTokenClaims, 'tokenType' | 'exp' | 'jti'>): IssuedIdentityToken {
    return this.issue(input, 'refresh', readTtl('IDENTITY_REFRESH_TOKEN_TTL_SECONDS', REFRESH_TOKEN_TTL_SECONDS));
  }

  verify(token: string, expectedType: IdentityTokenType): IdentityTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new IdentityTokenError();
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new IdentityTokenError();
    }

    const header = decodeJson(encodedHeader);
    if (
      !isPlainObject(header) ||
      header.alg !== TOKEN_HEADER.alg ||
      header.typ !== TOKEN_HEADER.typ ||
      Object.keys(header).length !== 2
    ) {
      throw new IdentityTokenError();
    }

    const expectedSignature = this.sign(`${encodedHeader}.${encodedPayload}`);
    const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      throw new IdentityTokenError();
    }

    const payload = decodeJson(encodedPayload);
    const claims = this.parseClaims(payload);
    if (claims.tokenType !== expectedType || claims.exp <= Math.floor(Date.now() / 1_000)) {
      throw new IdentityTokenError();
    }

    return claims;
  }

  private issue(
    input: Omit<IdentityTokenClaims, 'tokenType' | 'exp' | 'jti'>,
    tokenType: IdentityTokenType,
    ttlSeconds: number,
  ): IssuedIdentityToken {
    const claims: IdentityTokenClaims = {
      ...input,
      jti: randomUUID(),
      tokenType,
      exp: Math.floor(Date.now() / 1_000) + ttlSeconds,
    };
    const encodedHeader = encodeJson(TOKEN_HEADER);
    const encodedPayload = encodeJson(claims);
    const signature = this.sign(`${encodedHeader}.${encodedPayload}`).toString('base64url');

    return { token: `${encodedHeader}.${encodedPayload}.${signature}`, claims };
  }

  private sign(value: string): Buffer {
    return createHmac('sha256', this.secret()).update(value, 'utf8').digest();
  }

  private secret(): string {
    const secret = process.env.IDENTITY_JWT_SECRET;
    if (!secret || Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
      throw new Error('IDENTITY_JWT_SECRET must be configured with at least 32 bytes.');
    }

    return secret;
  }

  private parseClaims(value: unknown): IdentityTokenClaims {
    if (!isPlainObject(value)) {
      throw new IdentityTokenError();
    }

    const keys = Object.keys(value).sort();
    if (keys.length !== CLAIM_KEYS.length || keys.some((key, index) => key !== CLAIM_KEYS[index])) {
      throw new IdentityTokenError();
    }

    const { jti, sessionId, userId, tenantId, sessionVersion, tokenType, exp } = value;
    if (
      typeof jti !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jti) ||
      typeof sessionId !== 'string' || !sessionId ||
      typeof userId !== 'string' || !userId ||
      typeof tenantId !== 'string' || !tenantId ||
      typeof sessionVersion !== 'number' || !Number.isSafeInteger(sessionVersion) || sessionVersion < 0 ||
      (tokenType !== 'access' && tokenType !== 'refresh') ||
      typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= 0
    ) {
      throw new IdentityTokenError();
    }

    return { jti, sessionId, userId, tenantId, sessionVersion, tokenType, exp };
  }
}

