import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from './api-workspace-dependencies.mjs';

import { AppModule } from '../apps/api/dist/app.module.js';
import { ApiExceptionFilter } from '../apps/api/dist/common/api-exception.filter.js';

const localEnvironment = resolve('apps/api/.env.baseer-test');
if (existsSync(localEnvironment)) {
  dotenv.config({ path: localEnvironment, override: false, quiet: true });
}

const app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
app.setGlobalPrefix('v1');
app.useGlobalFilters(new ApiExceptionFilter());
await app.init();

try {
  const fastify = app.getHttpAdapter().getInstance();
  const signIn = async (remoteAddress, login) => fastify.inject({
    method: 'POST',
    url: '/v1/auth/sign-in',
    remoteAddress,
    headers: { 'content-type': 'application/json' },
    payload: { login, password: 'invalid-password' },
  });

  // The same login crosses two network addresses: this proves identity
  // throttling is independent of IP throttling and does not inspect accounts.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await signIn('203.0.113.77', 'throttle-identity-check');
    if (response.statusCode !== 401) throw new Error(`Expected 401 before identity limit, got ${response.statusCode}.`);
  }
  const identityBlocked = await signIn('203.0.113.78', 'throttle-identity-check');
  if (identityBlocked.statusCode !== 429 || identityBlocked.headers['retry-after'] !== '900') {
    throw new Error('Identity throttle did not return 429 with Retry-After 900.');
  }

  // Different identities from one source address cannot bypass the IP ceiling.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await signIn('203.0.113.79', `throttle-ip-check-${attempt}`);
    if (response.statusCode !== 401) throw new Error(`Expected 401 before IP limit, got ${response.statusCode}.`);
  }
  const ipBlocked = await signIn('203.0.113.79', 'throttle-ip-check-final');
  if (ipBlocked.statusCode !== 429 || ipBlocked.headers['retry-after'] !== '900') {
    throw new Error('IP throttle did not return 429 with Retry-After 900.');
  }

  console.log(JSON.stringify({
    status: 'verified',
    identity: '5 attempts then cross-IP 429',
    ip: '10 identities then same-IP 429',
    retryAfterSeconds: 900,
  }));
} finally {
  await app.close();
}
