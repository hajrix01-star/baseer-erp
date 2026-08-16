import { BadRequestException } from '@nestjs/common';

const SHORT_LOGIN = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;
const EMAIL_LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * BASEER stores one email-shaped login identifier per tenant. A short
 * username is a convenience input, not a second identity system: it is
 * resolved server-side to a deterministic tenant-local address.
 */
export function normalizeLoginIdentifier(login: string, tenantCode: string): string {
  const value = required(login, 'Login is required.').normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (EMAIL_LOGIN.test(value) && value.length <= 254) return value;
  if (!SHORT_LOGIN.test(value)) {
    throw new BadRequestException('Login must be an email address or a short username.');
  }
  return `${value}@${tenantLoginDomain(tenantCode)}`;
}

export function displayLoginIdentifier(loginNormalized: string, tenantCode: string): string {
  const domain = `@${tenantLoginDomain(tenantCode)}`;
  return loginNormalized.endsWith(domain) ? loginNormalized.slice(0, -domain.length) : loginNormalized;
}

function tenantLoginDomain(tenantCode: string): string {
  const value = required(tenantCode, 'Tenant code is required.').normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    throw new BadRequestException('Tenant code cannot resolve a login domain.');
  }
  return `${value}.baseer.local`;
}

function required(value: string, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(message);
  return value;
}