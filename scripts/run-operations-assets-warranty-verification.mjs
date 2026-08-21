import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be configured through apps/api/.env.baseer-test.");

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = { tenantId: randomUUID(), companyId: randomUUID(), actorUserId: randomUUID() };
const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.actorUserId };
let app;

try {
  await seedFixture();
  const [{ AppModule }, { DatabaseService }, { CompanyFinanceSetupService }, { PurchaseExpenseService }, { OperationsAssetsWarrantyService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/database/database.service.js"),
    import("../apps/api/dist/finance/company-finance-setup.service.js"),
    import("../apps/api/dist/finance/purchase-expense.service.js"),
    import("../apps/api/dist/operations/operations-assets-warranty.service.js"),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const setup = app.get(CompanyFinanceSetupService);
  const documents = app.get(PurchaseExpenseService);
  const assets = app.get(OperationsAssetsWarrantyService);

  await setup.initialize(context, { fiscalPeriodNameAr: "فترة تحقق الأصول", fiscalPeriodNameEn: "Assets verification period", fiscalPeriodStartDate: date("2026-01-01"), fiscalPeriodEndDate: date("2026-12-31"), selectedVaults: ["CASH"] });
  const master = await database.inTenantTransaction(fixture.tenantId, async (tx) => ({
    category: await tx.financeCategory.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, kind: "PURCHASE", status: "ACTIVE", isPosting: true }, select: { id: true } }),
    vault: await tx.financeVault.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: "CASH", status: "ACTIVE", isPaymentDestination: true }, select: { id: true } }),
  }));
  const posted = await documents.createBatch({ context, idempotencyKey: randomUUID(), request: { businessDate: date("2026-08-21"), items: [{ kind: "PURCHASE", settlementKind: "PAID", categoryId: master.category.id, supplierInvoiceMissingReason: "إيصال تحقق الأصول", grossAmount: "100.0000", isTaxable: false, assetWarrantyFollowUp: true, allocations: [{ vaultId: master.vault.id, grossAmount: "100.0000" }] }] } });
  const documentId = posted.documents[0].documentId;
  const journalCountBefore = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.financeJournalEntry.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }));

  let workspace = await assets.workspace(context);
  assert.equal(workspace.queue.length, 1, "A marked purchase document must appear in the asset queue.");
  await assets.setFollowUp(context, { documentId, enabled: false, idempotencyKey: randomUUID() });
  assert.equal((await assets.workspace(context)).queue.length, 0, "Removing follow-up must hide an unfinished source document.");
  await assets.setFollowUp(context, { documentId, enabled: true, idempotencyKey: randomUUID() });

  const request = { sourceDocumentId: documentId, nameAr: "ثلاجة التحقق", nameEn: "Verification refrigerator", serialNumber: `SN-${suffix}`, location: "المطبخ", warrantyProvider: "المورد", warrantyStartsAt: "2026-08-21", warrantyEndsAt: "2027-08-20", lines: [{ description: "ضاغط", serialNumber: `COMP-${suffix}`, warrantyEndsAt: "2027-08-20" }], idempotencyKey: randomUUID() };
  const created = await assets.createAsset(context, request);
  const replayed = await assets.createAsset(context, request);
  assert.equal(replayed.id, created.id, "The same idempotency key must replay the completed asset receipt.");
  assert.equal(replayed.replayed, true, "The duplicate create request must be marked as a replay.");
  await assert.rejects(() => assets.createAsset(context, { ...request, idempotencyKey: randomUUID() }), /already completed/i, "A source document must only create one Gate A asset record.");

  workspace = await assets.workspace(context);
  assert.equal(workspace.queue.length, 0, "A completed source must leave the asset follow-up queue.");
  assert.equal(workspace.assets.length, 1, "The completed asset must appear in the register.");
  assert.equal(workspace.assets[0].acquisitionAmount, "100.0000", "The source acquisition amount must be snapshotted.");
  assert.equal(workspace.assets[0].lines.length, 1, "Asset warranty lines must be retained.");
  await assets.archiveAsset(context, { assetId: created.id, idempotencyKey: randomUUID() });
  workspace = await assets.workspace(context);
  assert.equal(workspace.assets[0].status, "ARCHIVED", "Archiving must preserve the asset history.");
  await assert.rejects(() => assets.setFollowUp(context, { documentId, enabled: false, idempotencyKey: randomUUID() }), /traceable/i, "A completed asset source must retain its traceability marker.");

  const journalCountAfter = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.financeJournalEntry.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }));
  assert.equal(journalCountAfter, journalCountBefore, "Asset and warranty work must not create or modify financial journal entries.");
  const auditCount = await database.inTenantTransaction(fixture.tenantId, (tx) => tx.auditEvent.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, action: { startsWith: "operations.asset_warranty." } } }));
  assert.ok(auditCount >= 4, "Material asset workflow changes must be audited.");
  console.log(JSON.stringify({ ok: true, companyId: fixture.companyId, verified: ["queue", "follow_up", "asset_snapshot", "warranty_lines", "idempotency", "archive", "audit", "no_finance_posting"] }));
} finally {
  await app?.close();
  await pool.end();
}

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, `asset-warranty-${suffix}`, "Assets warranty verification"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.actorUserId, fixture.tenantId, `assets-${suffix}@baseer.test`, "مالك تحقق الأصول", "Assets verification owner", "verification-only"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, "شركة تحقق الأصول", "Assets verification company"]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function date(value) { return new Date(`${value}T00:00:00.000Z`); }
