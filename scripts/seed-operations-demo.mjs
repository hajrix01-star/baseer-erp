import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import { NestFactory } from "@nestjs/core";
import pg from "pg";

dotenv.config({ path: "apps/api/.env.baseer-test" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must be configured through apps/api/.env.baseer-test.");

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });
const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
let app;

try {
  const context = await currentCompanyContext();
  const [{ AppModule }, { OperationsCatalogService }, { OperationsExecutionService }, { OperationsInternalRegistrationService }] = await Promise.all([
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/operations/operations-catalog.service.js"),
    import("../apps/api/dist/operations/operations-execution.service.js"),
    import("../apps/api/dist/operations/operations-internal-registration.service.js"),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const catalog = app.get(OperationsCatalogService);
  const execution = app.get(OperationsExecutionService);
  const registrations = app.get(OperationsInternalRegistrationService);

  const kilogram = await unit(catalog, context, "KG", "كيلوغرام", "Kilogram", "MASS");
  const gram = await unit(catalog, context, "G", "جرام", "Gram", "MASS");
  const litre = await unit(catalog, context, "L", "لتر", "Litre", "VOLUME");
  const bottle = await unit(catalog, context, "BOTTLE", "عبوة", "Bottle", "PACKAGE");
  const piece = await unit(catalog, context, "PIECE", "حبة", "Piece", "COUNT");
  const kitchen = await section(catalog, context, "KITCHEN", "مطبخ تجريبي", "Demo kitchen");
  const bar = await section(catalog, context, "BAR", "بار تجريبي", "Demo bar");

  const tomato = await raw(catalog, context, "TOMATO", "طماطم تجريبية", kilogram.id, [price(kilogram.id, "5.0000"), price(gram.id, "0.0050")]);
  await conversion(catalog, context, tomato.id, [{ fromUnitId: gram.id, toUnitId: kilogram.id, factor: "0.00100000" }]);
  const oil = await raw(catalog, context, "OIL", "زيت تجريبي", litre.id, [price(litre.id, "12.0000"), price(bottle.id, "12.0000")]);
  await conversion(catalog, context, oil.id, [{ fromUnitId: bottle.id, toUnitId: litre.id, factor: "1.00000000" }]);
  const milk = await raw(catalog, context, "MILK", "حليب تجريبي", litre.id, [price(litre.id, "7.0000"), price(bottle.id, "7.0000")]);
  await conversion(catalog, context, milk.id, [{ fromUnitId: bottle.id, toUnitId: litre.id, factor: "1.00000000" }]);
  const meat = await raw(catalog, context, "MEAT", "لحم تجريبي", kilogram.id, [price(kilogram.id, "35.0000"), price(gram.id, "0.0350")]);
  await conversion(catalog, context, meat.id, [{ fromUnitId: gram.id, toUnitId: kilogram.id, factor: "0.00100000" }]);
  const orange = await raw(catalog, context, "ORANGE", "برتقال تجريبي", piece.id, [price(piece.id, "1.5000")]);
  const bread = await raw(catalog, context, "BREAD", "خبز تجريبي", piece.id, [price(piece.id, "1.0000")]);

  const shawarma = await menu(catalog, context, "SHAWARMA", "شاورما تجريبية", kitchen.id, piece.id, "14.0000");
  const orangeJuice = await menu(catalog, context, "ORANGE-JUICE", "عصير برتقال تجريبي", bar.id, piece.id, "9.0000");
  await execution.publishRecipe(context, {
    outputItemId: shawarma.id, outputUnitId: piece.id, outputQuantity: "1.00000000",
    lines: [ingredient(meat.id, kilogram.id, "0.15000000"), ingredient(tomato.id, kilogram.id, "0.05000000"), ingredient(bread.id, piece.id, "1.00000000")], idempotencyKey: randomUUID(),
  });
  await execution.publishRecipe(context, {
    outputItemId: orangeJuice.id, outputUnitId: piece.id, outputQuantity: "1.00000000",
    lines: [ingredient(orange.id, piece.id, "3.00000000"), ingredient(milk.id, litre.id, "0.10000000")], idempotencyKey: randomUUID(),
  });

  const custodyRequest = await execution.createPurchaseRequest(context, request("CUSTODY", [line(tomato.id, kilogram.id, "3.00000000", "5.0000"), line(oil.id, bottle.id, "2.00000000", "12.0000")], { custodyFundingAmount: "100.0000", representativeName: "مندوب تجريبي" }));
  await complete(execution, context, custodyRequest.id, [actual(tomato.id, kilogram.id, "3.00000000", "6.0000"), actual(oil.id, bottle.id, "2.00000000", "12.0000")], "فرق سعر الطماطم في التجربة");
  const cashRequest = await execution.createPurchaseRequest(context, request("CASH", [line(milk.id, bottle.id, "4.00000000", "7.0000"), line(orange.id, piece.id, "20.00000000", "1.5000"), line(bread.id, piece.id, "12.00000000", "1.0000")]));
  await complete(execution, context, cashRequest.id, [actual(milk.id, bottle.id, "4.00000000", "7.0000"), actual(orange.id, piece.id, "20.00000000", "1.5000"), actual(bread.id, piece.id, "12.00000000", "1.0000")]);
  const transferRequest = await execution.createPurchaseRequest(context, request("BANK_TRANSFER", [line(meat.id, kilogram.id, "2.00000000", "35.0000")]));
  await complete(execution, context, transferRequest.id, [actual(meat.id, kilogram.id, "2.00000000", "35.0000")], undefined, `DEMO-TRANSFER-${suffix}`);
  await execution.returnCustody(context, { requestId: custodyRequest.id, businessDate: "2026-08-21", amount: "58.0000", notes: "إرجاع متبقي العهدة التجريبية", idempotencyKey: randomUUID() }, randomUUID());

  await registrations.create(context, { businessDate: "2026-08-21", sectionId: kitchen.id, notes: "تسجيل إنتاج مطبخ تجريبي", lines: [{ menuProductItemId: shawarma.id, unitId: piece.id, quantity: "3.00000000" }], idempotencyKey: randomUUID() });
  await registrations.create(context, { businessDate: "2026-08-21", sectionId: bar.id, notes: "تسجيل إنتاج بار تجريبي", lines: [{ menuProductItemId: orangeJuice.id, unitId: piece.id, quantity: "4.00000000" }], idempotencyKey: randomUUID() });

  const [workspace, received, custody, registrationReport, workstation] = await Promise.all([
    execution.workspace(context), execution.materialsReceivedReport(context, { from: "2026-08-01", to: "2026-08-31" }), execution.custodyMonthlyReport(context, { from: "2026-08-01", to: "2026-08-31" }), registrations.report(context, { from: "2026-08-01", to: "2026-08-31" }), registrations.workstation(context),
  ]);
  assert.equal(workspace.requests.length, 3);
  assert.equal(workspace.custody.balance, "0");
  assert.equal(received.totals.materialCount, 6);
  assert.equal(custody.months[0]?.closingBalance, "0");
  assert.equal(registrationReport.totals.registrationCount, 2);
  assert.equal("menuSaleUnitPrice" in workstation.products[0], false, "The staff workstation must remain price-free.");
  console.log(JSON.stringify({ ok: true, companyNameAr: "شركة بصير المحلية", created: { units: 5, sections: 2, rawMaterials: 6, menuProducts: 2, recipes: 2, purchaseRequests: 3, internalRegistrations: 2 }, reports: { materials: received.totals, custodyClosingBalance: custody.months[0]?.closingBalance, registrations: registrationReport.totals } }));
} finally {
  await app?.close();
  await pool.end();
}

function price(unitId, lastPurchaseUnitPrice) { return { unitId, lastPurchaseUnitPrice }; }
function ingredient(rawMaterialItemId, unitId, quantity) { return { rawMaterialItemId, unitId, quantity }; }
function line(rawMaterialItemId, requestedUnitId, requestedQuantity, quotedUnitPrice) { return { rawMaterialItemId, requestedUnitId, requestedQuantity, quotedUnitPrice }; }
function actual(rawMaterialItemId, receivedUnitId, receivedQuantity, actualUnitPrice) { return { rawMaterialItemId, receivedUnitId, receivedQuantity, actualUnitPrice }; }
function request(paymentChannel, lines, extra = {}) { return { businessDate: "2026-08-21", paymentChannel, lines, idempotencyKey: randomUUID(), ...extra }; }

async function unit(catalog, context, code, nameAr, nameEn, dimension) {
  return catalog.createUnit(context, { code: `DEMO-${code}-${suffix}`, nameAr, nameEn, dimension }, randomUUID());
}
async function section(catalog, context, code, nameAr, nameEn) {
  return catalog.createSection(context, { code: `DEMO-${code}-${suffix}`, nameAr, nameEn }, randomUUID());
}
async function raw(catalog, context, code, nameAr, baseUnitId, unitPrices) {
  return catalog.createItem(context, { code: `DEMO-${code}-${suffix}`, nameAr, kind: "RAW_MATERIAL", baseUnitId, unitPrices }, randomUUID());
}
async function menu(catalog, context, code, nameAr, sectionId, baseUnitId, menuSaleUnitPrice) {
  return catalog.createItem(context, { code: `DEMO-${code}-${suffix}`, nameAr, kind: "MENU_PRODUCT", sectionId, baseUnitId, unitPrices: [{ unitId: baseUnitId, menuSaleUnitPrice }] }, randomUUID());
}
async function conversion(catalog, context, itemId, edges) {
  await catalog.publishConversions(context, itemId, edges, randomUUID());
}
async function complete(execution, context, requestId, actualLines, notes, paymentReference) {
  const workspace = await execution.workspace(context);
  const request = workspace.requests.find((entry) => entry.id === requestId);
  assert.ok(request, "The purchase request must be visible before completion.");
  const requestLineByMaterial = new Map(request.lines.map((entry) => [entry.rawMaterialItemId, entry.id]));
  await execution.receivePurchaseRequest(context, {
    requestId, businessDate: "2026-08-21", ...(notes ? { notes } : {}), ...(paymentReference ? { paymentReference } : {}),
    lines: actualLines.map((entry) => ({ requestLineId: requestLineByMaterial.get(entry.rawMaterialItemId), receivedUnitId: entry.receivedUnitId, receivedQuantity: entry.receivedQuantity, actualUnitPrice: entry.actualUnitPrice })), idempotencyKey: randomUUID(),
  });
}

async function currentCompanyContext() {
  const supplied = {
    tenantId: process.env.BASEER_DEMO_TENANT_ID,
    companyId: process.env.BASEER_DEMO_COMPANY_ID,
    actorUserId: process.env.BASEER_DEMO_ACTOR_USER_ID,
  };
  if (supplied.tenantId && supplied.companyId && supplied.actorUserId) return supplied;
  const result = await pool.query(`
    WITH target AS (
      SELECT id, "tenantId" FROM "Company" WHERE "nameAr" = 'شركة بصير المحلية' ORDER BY "createdAt" DESC LIMIT 1
    )
    SELECT target."tenantId" AS "tenantId", target.id AS "companyId", membership."userId" AS "actorUserId"
    FROM target
    JOIN "CompanyMembership" membership ON membership."companyId" = target.id
    JOIN "Role" role ON role.id = membership."roleId"
    WHERE role.code = 'BASEER_COMPANY_MANAGER'
    ORDER BY membership."userId" LIMIT 1
  `);
  if (result.rowCount !== 1) throw new Error("Provide the local company context through BASEER_DEMO_TENANT_ID, BASEER_DEMO_COMPANY_ID, and BASEER_DEMO_ACTOR_USER_ID.");
  return result.rows[0];
}
