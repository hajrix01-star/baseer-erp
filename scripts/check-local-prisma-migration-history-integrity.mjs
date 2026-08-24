import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing history-integrity check outside the canonical local Baseer test database.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  // Prisma keeps a historical row when `migrate resolve --rolled-back` is
  // used. That row is not an unresolved failure and must remain auditable.
  const failed = await pool.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL');
  const applied = await pool.query('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL');
  const mismatches = [];
  for (const migration of applied.rows) {
    try {
      const source = await readFile(resolve('apps/api/prisma/migrations', migration.migration_name, 'migration.sql'));
      const checksum = createHash('sha256').update(source).digest('hex');
      if (checksum !== migration.checksum) mismatches.push(migration.migration_name);
    } catch {
      mismatches.push(`${migration.migration_name} (source missing)`);
    }
  }
  if (failed.rowCount || mismatches.length) {
    throw new Error(`Prisma migration-history integrity failed: failed=${failed.rowCount}; checksumMismatches=${mismatches.join(', ') || 'none'}`);
  }
  console.log(JSON.stringify({ status: 'healthy', applied: applied.rowCount, failed: 0, checksumMismatches: 0 }));
} finally {
  await pool.end();
}
