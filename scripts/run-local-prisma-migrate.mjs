import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

const action = process.argv[2];
const attendanceIndexFailure = '20260829030000_attendance_session_employee_date_index';
if (!['status', 'deploy', 'resolve-attendance-index-failure'].includes(action)) {
  throw new Error('Usage: node scripts/run-local-prisma-migrate.mjs <status|deploy|resolve-attendance-index-failure>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing Prisma migration command outside the canonical local Baseer test database.');
}

/**
 * The application role is intentionally restricted and must not own database
 * types. Local deploys therefore use either an explicitly supplied migrator
 * URL or the disposable test container's bootstrap role, while all normal
 * API/test traffic continues to use DATABASE_URL as the restricted role.
 * The password is read into process memory only and never printed or written.
 */
function localMigratorUrl() {
  const configured = process.env.BASEER_DB_MIGRATOR_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/baseer_erp_test') {
      throw new Error('BASEER_DB_MIGRATOR_URL must point only to the canonical local Baseer test database.');
    }
    return url.toString();
  }

  const password = spawnSync(
    'docker',
    ['exec', 'baseer-erp-postgres', 'sh', '-c', 'printf %s "$POSTGRES_PASSWORD"'],
    { encoding: 'utf8' },
  );
  if (password.error || password.status !== 0 || !password.stdout.trim()) {
    throw new Error('A local PostgreSQL migrator is required. Start baseer-erp-postgres or set BASEER_DB_MIGRATOR_URL for 127.0.0.1:5433/baseer_erp_test.');
  }
  const url = new URL('postgresql://postgres@127.0.0.1:5433/baseer_erp_test');
  url.password = password.stdout.trim();
  return url.toString();
}

const prismaDatabaseUrl = action === 'status' ? databaseUrl.toString() : localMigratorUrl();
const prismaArgs = action === 'resolve-attendance-index-failure'
  ? ['migrate', 'resolve', '--rolled-back', attendanceIndexFailure, '--config', 'apps/api/prisma.config.ts']
  : ['migrate', action, '--config', 'apps/api/prisma.config.ts'];

const prismaCli = resolve('node_modules/prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, ...prismaArgs], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: prismaDatabaseUrl },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
