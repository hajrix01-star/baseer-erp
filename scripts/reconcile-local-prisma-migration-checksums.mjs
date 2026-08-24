import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing checksum reconciliation outside the canonical local Baseer test database.');
}

const migrations = [
  '20260816205000_inclusive_loan_installment_vault_integrity',
  '20260816206000_cash_handover_management_only',
];
const backupTable = '_baseer_prisma_migration_checksum_backup_20260824';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const assertPhysicalSchema = async (client) => {
  const checks = [
    await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FinanceInclusiveLoanInstallmentPlan' AND column_name = 'financeVaultId' AND data_type = 'uuid'`),
    await client.query(`SELECT 1 FROM pg_constraint WHERE conrelid = '"FinanceInclusiveLoanInstallmentPlan"'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) LIKE '%FOREIGN KEY ("financeVaultId", "tenantId", "companyId")%'`),
    await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'FinanceInclusiveLoanInstallmentPlan' AND indexname = 'FinanceInclusiveLoanInstallmentPlan_tenant_company_vault_idx'`),
    await client.query(`SELECT 1 FROM pg_constraint WHERE conrelid = '"FinanceDailySalesClosing"'::regclass AND conname IN ('FinanceDailySalesClosing_cash_handover_pair', 'FinanceDailySalesClosing_cash_handover_vault_fkey')`),
  ];
  if (!checks[0].rowCount || !checks[1].rowCount || !checks[2].rowCount || checks[3].rowCount) {
    throw new Error('Refusing checksum reconciliation because the physical test schema does not match the two migration outcomes.');
  }
};

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertPhysicalSchema(client);
    const records = await client.query(`SELECT id, migration_name, checksum FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL`, [migrations]);
    if (records.rowCount !== migrations.length || new Set(records.rows.map((row) => row.migration_name)).size !== migrations.length) {
      throw new Error('Refusing checksum reconciliation because each target migration must have exactly one successful history record.');
    }
    const failed = await client.query(`SELECT 1 FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[]) AND finished_at IS NULL`, [migrations]);
    if (failed.rowCount) throw new Error('Refusing checksum reconciliation while failed attempts exist.');

    await client.query(`CREATE TABLE IF NOT EXISTS "${backupTable}" (migration_id TEXT PRIMARY KEY, migration_name TEXT NOT NULL, previous_checksum TEXT NOT NULL, reconciled_checksum TEXT NOT NULL, reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(), recovery_id UUID NOT NULL)`);
    const recoveryId = randomUUID();
    let updated = 0;
    for (const record of records.rows) {
      const source = await readFile(resolve('apps/api/prisma/migrations', record.migration_name, 'migration.sql'));
      const currentChecksum = createHash('sha256').update(source).digest('hex');
      if (record.checksum === currentChecksum) continue;
      await client.query(`INSERT INTO "${backupTable}" (migration_id, migration_name, previous_checksum, reconciled_checksum, recovery_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (migration_id) DO NOTHING`, [record.id, record.migration_name, record.checksum, currentChecksum, recoveryId]);
      const result = await client.query(`UPDATE "_prisma_migrations" SET checksum = $1 WHERE id = $2 AND checksum = $3`, [currentChecksum, record.id, record.checksum]);
      if (result.rowCount !== 1) throw new Error(`Checksum changed concurrently for ${record.migration_name}.`);
      updated += 1;
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'reconciled', recoveryId, backupTable, updated }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
