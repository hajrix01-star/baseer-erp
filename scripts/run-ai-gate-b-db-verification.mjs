import { Client } from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const columns = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'AiExecutionReceipt'
      AND column_name IN ('skillKey', 'skillVersion', 'policyVersion')
  `);
  const found = new Set(columns.rows.map((row) => row.column_name));
  const missing = ["skillKey", "skillVersion", "policyVersion"].filter((name) => !found.has(name));
  if (missing.length) throw new Error(`AI Gate B columns are missing: ${missing.join(", ")}`);

  const policy = await client.query(`
    SELECT relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE oid = 'public."AiExecutionReceipt"'::regclass
  `);
  if (policy.rowCount !== 1 || !policy.rows[0].relrowsecurity || !policy.rows[0].relforcerowsecurity) {
    throw new Error("AiExecutionReceipt RLS/FORCE RLS is not enabled.");
  }
  const migration = await client.query(`
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20260816200000_ai_gate_b_runtime_receipts'
      AND finished_at IS NOT NULL
  `);
  if (migration.rowCount !== 1) throw new Error("AI Gate B migration is not recorded as applied.");
  console.log("AI Gate B database verification passed.");
} finally {
  await client.end();
}