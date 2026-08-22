import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import { operationsCatalogReceiptSchema } from "@baseer-erp/contracts";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured through apps/api/.env.baseer-test.");

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  companyId: randomUUID(),
  actorUserId: randomUUID(),
  tenantCode: `operations-cycle-${suffix}`,
};
const context = { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId: fixture.actorUserId };
let app;

try {
  await seedFixture();
  const [{ AppModule }, { OperationsCatalogService }, { OperationsExecutionService }, { OperationsInternalRegistrationService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/operations/operations-catalog.service.js"),
    import("../apps/api/dist/operations/operations-execution.service.js"),
    import("../apps/api/dist/operations/operations-internal-registration.service.js"),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const catalog = app.get(OperationsCatalogService);
  const execution = app.get(OperationsExecutionService);
  const internalRegistration = app.get(OperationsInternalRegistrationService);

  const kilogram = await catalog.createUnit(context, { code: `KG-${suffix}`, nameAr: "كيلوغرام", nameEn: "Kilogram", dimension: "MASS" }, randomUUID());
  const tomato = await catalog.createItem(context, {
    code: `TOMATO-${suffix}`, nameAr: "طماطم تحقق", nameEn: "Verification tomato", kind: "RAW_MATERIAL", baseUnitId: kilogram.id,
    unitPrices: [{ unitId: kilogram.id, lastPurchaseUnitPrice: "10.0000" }],
  }, randomUUID());
  await catalog.configureItemUnits(context, {
    itemId: tomato.id,
    units: [{ unitId: kilogram.id, isActive: true, isOrderEnabled: true }],
  }, randomUUID());

  const custodyRequest = await execution.createPurchaseRequest(context, {
    businessDate: "2026-08-21", paymentChannel: "CUSTODY", custodyFundingAmount: "50.0000", representativeName: "مندوب التحقق",
    lines: [{ rawMaterialItemId: tomato.id, requestedUnitId: kilogram.id, requestedQuantity: "3.00000000", quotedUnitPrice: "10.0000" }], idempotencyKey: randomUUID(),
  });
  const custodyLine = await requestLine(execution, custodyRequest.id);
  await execution.receivePurchaseRequest(context, {
    requestId: custodyRequest.id, businessDate: "2026-08-21", notes: "فرق سعر التحقق", lines: [{ requestLineId: custodyLine.id, rawMaterialItemId: tomato.id, receivedQuantity: "3.00000000", receivedUnitId: kilogram.id, actualUnitPrice: "11.0000" }], idempotencyKey: randomUUID(),
  });

  const cashRequest = await execution.createPurchaseRequest(context, {
    businessDate: "2026-08-21", paymentChannel: "CASH",
    lines: [{ rawMaterialItemId: tomato.id, requestedUnitId: kilogram.id, requestedQuantity: "2.00000000", quotedUnitPrice: "12.0000" }], idempotencyKey: randomUUID(),
  });
  const cashLine = await requestLine(execution, cashRequest.id);
  await execution.receivePurchaseRequest(context, {
    requestId: cashRequest.id, businessDate: "2026-08-21", lines: [{ requestLineId: cashLine.id, rawMaterialItemId: tomato.id, receivedQuantity: "2.00000000", receivedUnitId: kilogram.id, actualUnitPrice: "12.0000" }], idempotencyKey: randomUUID(),
  });

  const transferRequest = await execution.createPurchaseRequest(context, {
    businessDate: "2026-08-21", paymentChannel: "BANK_TRANSFER",
    lines: [{ rawMaterialItemId: tomato.id, requestedUnitId: kilogram.id, requestedQuantity: "1.00000000", quotedUnitPrice: "13.0000" }], idempotencyKey: randomUUID(),
  });
  const transferLine = await requestLine(execution, transferRequest.id);
  await execution.receivePurchaseRequest(context, {
    requestId: transferRequest.id, businessDate: "2026-08-21", paymentReference: `TRX-${suffix}`,
    lines: [{ requestLineId: transferLine.id, rawMaterialItemId: tomato.id, receivedQuantity: "1.00000000", receivedUnitId: kilogram.id, actualUnitPrice: "13.0000" }], idempotencyKey: randomUUID(),
  });

  let workspace = await execution.workspace(context);
  assert.equal(workspace.inventory.find((row) => row.rawMaterialItemId === tomato.id)?.baseQuantity, "6", "All completed purchases must update stock.");
  assert.equal(workspace.custody.balance, "17", "Custody must retain funding minus actual purchase value.");
  assert.equal(workspace.requests.find((request) => request.id === transferRequest.id)?.receipts[0]?.paymentReference, `TRX-${suffix}`, "A transfer reference must be preserved with the operational completion.");
  const received = await execution.materialsReceivedReport(context, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(received.materials[0]?.quantity, "6", "The materials report must include actual completed quantities only.");
  const custodyReport = await execution.custodyMonthlyReport(context, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(custodyReport.months[0]?.closingBalance, "17", "The monthly custody report must expose the delegate balance.");

  const custodyReceiptId = workspace.requests.find((request) => request.id === custodyRequest.id)?.receipts[0]?.id;
  assert.ok(custodyReceiptId, "A completed purchase must retain its internal posting snapshot.");
  await execution.reversePurchaseReceipt(context, { receiptId: custodyReceiptId, businessDate: "2026-08-21", idempotencyKey: randomUUID() });
  workspace = await execution.workspace(context);
  assert.equal(workspace.inventory.find((row) => row.rawMaterialItemId === tomato.id)?.baseQuantity, "3", "Correction must reverse only the corrected purchase stock impact.");
  assert.equal(workspace.custody.balance, "50", "Correction must restore the delegate balance without rewriting the original event.");
  await execution.returnCustody(context, { requestId: custodyRequest.id, businessDate: "2026-08-21", amount: "50.0000", notes: "إقفال تحقق العهدة", idempotencyKey: randomUUID() }, randomUUID());
  workspace = await execution.workspace(context);
  assert.equal(workspace.custody.balance, "0", "Returning custody must settle its visible balance.");

  const grillSection = await catalog.createSection(context, { code: `GRILL-${suffix}`, nameAr: "مشويات تحقق", nameEn: "Verification grill" }, randomUUID());
  const grilledTomato = await catalog.createItem(context, {
    code: `GRILLED-TOMATO-${suffix}`, nameAr: "طماطم مشوية تحقق", nameEn: "Verification grilled tomato", kind: "MENU_PRODUCT", sectionId: grillSection.id, baseUnitId: kilogram.id,
    unitPrices: [{ unitId: kilogram.id, menuSaleUnitPrice: "20.0000" }],
  }, randomUUID());
  await execution.publishRecipe(context, {
    outputItemId: grilledTomato.id, outputUnitId: kilogram.id, outputQuantity: "1.00000000",
    lines: [{ rawMaterialItemId: tomato.id, unitId: kilogram.id, quantity: "2.00000000" }], idempotencyKey: randomUUID(),
  });
  const workstation = await internalRegistration.workstation(context);
  assert.ok(workstation.sections.some((section) => section.id === grillSection.id), "The workstation must expose the active menu section.");
  assert.ok(workstation.products.some((product) => product.id === grilledTomato.id), "The workstation must expose the active menu product without pricing.");
  await internalRegistration.create(context, {
    businessDate: "2026-08-21", sectionId: grillSection.id,
    lines: [{ menuProductItemId: grilledTomato.id, unitId: kilogram.id, quantity: "1.00000000" }], idempotencyKey: randomUUID(),
  });
  const registrationReport = await internalRegistration.report(context, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(registrationReport.totals.registrationCount, 1, "The internal registration report must include the saved registration.");
  assert.equal(registrationReport.totals.amount, "20.0000", "The management report must preserve the menu price snapshot.");
  workspace = await execution.workspace(context);
  assert.equal(workspace.inventory.find((row) => row.rawMaterialItemId === tomato.id)?.baseQuantity, "1", "The published recipe must consume inventory exactly once on internal registration.");

  const rawCatalogPage = operationsCatalogReceiptSchema.parse(await catalog.catalog(context, { kind: "RAW_MATERIAL", status: "ACTIVE", search: "طماطم", pageSize: 10 }));
  assert.deepEqual(rawCatalogPage.items.map((item) => item.id), [tomato.id], "Catalog filtering must stay inside the requested item kind, status, and search scope.");
  assert.equal(rawCatalogPage.metrics.activeRawMaterialCount, 1, "Catalog metrics must describe the full company scope rather than only the current page.");
  assert.equal(rawCatalogPage.nextCursor, null, "A bounded one-row catalog result must not advertise another page.");
  await assert.rejects(() => catalog.catalog(context, { kind: "RAW_MATERIAL", status: "ACTIVE", cursor: randomUUID(), pageSize: 10 }), /outside this company and filter scope/, "A cursor outside the live company/filter scope must be rejected.");

  console.log(JSON.stringify({ ok: true, companyId: fixture.companyId, companyNameAr: "شركة تحقق دورة العمليات", verified: ["cash", "custody", "bank_transfer", "inventory", "materials_report", "custody_report", "owner_correction", "recipe", "internal_registration", "inventory_consumption", "catalog_filtering", "catalog_cursor_scope"] }));
} finally {
  await app?.close();
  await pool.end();
}

async function requestLine(execution, requestId) {
  const workspace = await execution.workspace(context);
  const line = workspace.requests.find((request) => request.id === requestId)?.lines[0];
  assert.ok(line, "The saved purchase plan must expose its line for completion.");
  return line;
}

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, "Operations cycle verification"]);
    await client.query('INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)', [fixture.actorUserId, fixture.tenantId, `operations-owner-${suffix}@baseer.test`, "مالك تحقق العمليات", "Operations verification owner", "verification-only"]);
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, "شركة تحقق دورة العمليات", "Operations cycle verification company"]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
