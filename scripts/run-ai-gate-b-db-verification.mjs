import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (or apps/api/.env.baseer-test must define it).");
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const columns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'AiExecutionReceipt'
      AND column_name IN ('skillKey', 'skillVersion', 'policyVersion', 'systemIdentityId', 'systemIdentityVersion')
  `);
  const found = new Set(columns.rows.map((row) => row.column_name));
  const requiredColumns = ["skillKey", "skillVersion", "policyVersion", "systemIdentityId", "systemIdentityVersion"];
  const missing = requiredColumns.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`AI Gate B columns are missing: ${missing.join(", ")}`);

  const policy = await client.query(`
    SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE oid = 'public."AiExecutionReceipt"'::regclass
  `);
  if (policy.rowCount !== 1 || !policy.rows[0].relrowsecurity || !policy.rows[0].relforcerowsecurity) {
    throw new Error("AiExecutionReceipt RLS/FORCE RLS is not enabled.");
  }

  const migrations = await client.query(`
    SELECT migration_name FROM "_prisma_migrations"
    WHERE migration_name IN ('20260816200000_ai_gate_b_runtime_receipts', '20260816201000_ai_gate_b_receipt_integrity')
      AND finished_at IS NOT NULL
  `);
  if (migrations.rowCount !== 2) throw new Error("AI Gate B receipt migrations are not recorded as applied.");

  const constraints = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public."AiExecutionReceipt"'::regclass
      AND conname = 'AiExecutionReceipt_versions_positive'
  `);
  if (constraints.rowCount !== 1) throw new Error("AI Gate B receipt-integrity constraint is missing.");

  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'AiExecutionReceipt'
      AND indexname = 'AiExecutionReceipt_tenant_system_identity_created_idx'
  `);
  if (indexes.rowCount !== 1) throw new Error("AI Gate B system-identity index is missing.");

  await verifyReceiptConstraint();
  console.log("AI Gate B database verification passed: schema, RLS, migrations, indexes and receipt-integrity constraints are active.");
} finally {
  await client.end();
}

async function expectCheckViolation(action, message) {
  await client.query("SAVEPOINT ai_gate_b_invalid_receipt");
  try {
    await action();
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT ai_gate_b_invalid_receipt");
    assert.equal(error?.code, "23514", message);
    return;
  }
  throw new Error(message);
}
async function verifyReceiptConstraint() {
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const makeInsert = (fields) => client.query(
    `INSERT INTO "AiExecutionReceipt" ("id", "tenantId", "companyId", "moduleKey", "capability", "outcome", "requestId", "skillKey", "skillVersion", "policyVersion")
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'administration', 'platform.ai.use', 'BLOCKED', $4, $5, $6, $7)`,
    [randomUUID(), tenantId, companyId, randomUUID(), fields.skillKey ?? null, fields.skillVersion ?? null, fields.policyVersion ?? null],
  );
  await client.query("BEGIN");
  try {
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [tenantId, `ai-gate-b-${tenantId.slice(0, 8)}`, "AI Gate B verification"]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [companyId, tenantId, "Verification company", "Verification company"]);

    await expectCheckViolation(() => makeInsert({ skillVersion: 1 }), "A partial skill receipt must be rejected by the database.");
    await expectCheckViolation(() => makeInsert({ skillKey: "", skillVersion: 1, policyVersion: 1 }), "A blank skill key must be rejected by the database.");
    await makeInsert({});
    await makeInsert({ skillKey: "administration.guide", skillVersion: 1, policyVersion: 1 });
  } finally {
    await client.query("ROLLBACK");
  }
}