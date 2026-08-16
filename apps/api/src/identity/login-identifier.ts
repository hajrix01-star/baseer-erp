import { BadRequestException } from '@nestjs/common';

const SHORT_LOGIN = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;
const EMAIL_LOGIN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_LOGIN_DOMAIN = 'hajrix.com';
const LEGACY_INTERNAL_DOMAIN_SUFFIX = '.baseer.local';

/**
 * BASEER keeps a stable internal user ID. A short login is only a convenient
 * input: it resolves to the system-wide Hajrix email domain and may be changed
 * later without changing the user ID, memberships, audit history, or reports.
 */
export function normalizeLoginIdentifier(login: string, _tenantCode: string): string {
  const value = required(login, 'Login is required.').normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (EMAIL_LOGIN.test(value) && value.length <= 254) return value;
  if (!SHORT_LOGIN.test(value)) throw new BadRequestException('Login must be an email address or a short username.');
  return `${value}@${DEFAULT_LOGIN_DOMAIN}`;
}

export function displayLoginIdentifier(loginNormalized: string, _tenantCode: string): string {
  const value = loginNormalized.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (value.endsWith(`@${DEFAULT_LOGIN_DOMAIN}`) || value.endsWith(LEGACY_INTERNAL_DOMAIN_SUFFIX)) {
    return value.slice(0, value.indexOf('@'));
  }
  return value;
}

export function defaultLoginDomain(): string {
  return DEFAULT_LOGIN_DOMAIN;
}

function required(value: string, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(message);
  return value;
}