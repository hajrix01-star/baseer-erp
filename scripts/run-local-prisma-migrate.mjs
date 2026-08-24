import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

const action = process.argv[2];
if (!['status', 'deploy'].includes(action)) {
  throw new Error('Usage: node scripts/run-local-prisma-migrate.mjs <status|deploy>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing Prisma migration command outside the canonical local Baseer test database.');
}

const prismaCli = resolve('node_modules/prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, 'migrate', action, '--config', 'apps/api/prisma.config.ts'], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
