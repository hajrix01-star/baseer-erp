import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing migration-history recovery outside the canonical local Baseer test database.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const backupTable = '_baseer_prisma_failed_migration_attempts_20260824';

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attempts = await client.query(`
      SELECT migration_name, checksum, finished_at IS NOT NULL AS succeeded
      FROM "_prisma_migrations"
      WHERE (finished_at IS NULL AND rolled_back_at IS NULL)
        OR migration_name IN (SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    `);
    const failedNames = [...new Set(attempts.rows.filter((row) => !row.succeeded).map((row) => row.migration_name))];
    const unmatched = [];
    for (const migrationName of failedNames) {
      const succeeded = attempts.rows.find((row) => row.migration_name === migrationName && row.succeeded);
      if (!succeeded) {
        unmatched.push(`${migrationName} (no successful counterpart)`);
        continue;
      }
      const source = await readFile(resolve('apps/api/prisma/migrations', migrationName, 'migration.sql'));
      const currentChecksum = createHash('sha256').update(source).digest('hex');
      if (currentChecksum !== succeeded.checksum) unmatched.push(`${migrationName} (current source checksum differs from successful record)`);
    }
    if (unmatched.length) {
      throw new Error(`Refusing recovery: ${unmatched.join(', ')}`);
    }
    await client.query(`CREATE TABLE IF NOT EXISTS "${backupTable}" (LIKE "_prisma_migrations" INCLUDING ALL)`);
    const backedUp = await client.query(`
      INSERT INTO "${backupTable}" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      SELECT failed.id, failed.checksum, failed.finished_at, failed.migration_name, failed.logs, failed.rolled_back_at, failed.started_at, failed.applied_steps_count
      FROM "_prisma_migrations" AS failed
      WHERE failed.finished_at IS NULL
        AND failed.rolled_back_at IS NULL
        AND EXISTS (
          SELECT 1 FROM "_prisma_migrations" AS succeeded
          WHERE succeeded.migration_name = failed.migration_name
            AND succeeded.finished_at IS NOT NULL
        )
        AND NOT EXISTS (SELECT 1 FROM "${backupTable}" AS backup WHERE backup.id = failed.id)
      RETURNING id
    `);
    const removed = await client.query(`
      DELETE FROM "_prisma_migrations" AS failed
      WHERE failed.finished_at IS NULL
        AND failed.rolled_back_at IS NULL
        AND EXISTS (
          SELECT 1 FROM "_prisma_migrations" AS succeeded
          WHERE succeeded.migration_name = failed.migration_name
            AND succeeded.finished_at IS NOT NULL
        )
      RETURNING id
    `);
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'reconciled', recoveryId: randomUUID(), backupTable, backedUp: backedUp.rowCount, removed: removed.rowCount }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
