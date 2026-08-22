import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = {
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
};
const businessDate = '2026-08-22';
const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
const marker = `اختبار تشغيلي فعلي ${businessDate}`;
let app;

try {
  const [
    { AppModule },
    { OperationsCatalogService },
    { OperationsExecutionService },
    { OperationsInternalRegistrationService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/operations/operations-catalog.service.js'),
    import('../apps/api/dist/operations/operations-execution.service.js'),
    import('../apps/api/dist/operations/operations-internal-registration.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const catalog = app.get(OperationsCatalogService);
  const execution = app.get(OperationsExecutionService);
  const registrations = app.get(OperationsInternalRegistrationService);

  const kilogram = await catalog.createUnit(context, {
    code: `LIVE-KG-${suffix}`,
    nameAr: `${marker} كيلوجرام`,
    nameEn: `Live test kilogram ${suffix}`,
    dimension: 'MASS',
  }, randomUUID());
  const raw = await catalog.createItem(context, {
    code: `LIVE-RAW-${suffix}`,
    nameAr: `${marker} طماطم خام`,
    nameEn: `Live test raw tomato ${suffix}`,
    kind: 'RAW_MATERIAL',
    baseUnitId: kilogram.id,
    unitPrices: [{ unitId: kilogram.id, lastPurchaseUnitPrice: '10.0000' }],
  }, randomUUID());
  await catalog.configureItemUnits(context, {
    itemId: raw.id,
    units: [{ unitId: kilogram.id, isActive: true, isOrderEnabled: true }],
  }, randomUUID());

  const custodyRequest = await execution.createPurchaseRequest(context, {
    businessDate,
    paymentChannel: 'CUSTODY',
    custodyFundingAmount: '50.0000',
    representativeName: `${marker} مندوب`,
    lines: [{ rawMaterialItemId: raw.id, requestedUnitId: kilogram.id, requestedQuantity: '3.00000000', quotedUnitPrice: '10.0000' }],
    idempotencyKey: randomUUID(),
  });
  const custodyLine = await requestLine(execution, custodyRequest.id);
  const custodyReceipt = await execution.receivePurchaseRequest(context, {
    requestId: custodyRequest.id,
    businessDate,
    notes: `${marker} استلام عهدة بفارق سعر`,
    lines: [{ requestLineId: custodyLine.id, rawMaterialItemId: raw.id, receivedQuantity: '3.00000000', receivedUnitId: kilogram.id, actualUnitPrice: '11.0000' }],
    idempotencyKey: randomUUID(),
  });

  const cashRequest = await execution.createPurchaseRequest(context, {
    businessDate,
    paymentChannel: 'CASH',
    lines: [{ rawMaterialItemId: raw.id, requestedUnitId: kilogram.id, requestedQuantity: '2.00000000', quotedUnitPrice: '12.0000' }],
    idempotencyKey: randomUUID(),
  });
  const cashLine = await requestLine(execution, cashRequest.id);
  const cashReceipt = await execution.receivePurchaseRequest(context, {
    requestId: cashRequest.id,
    businessDate,
    notes: `${marker} استلام نقدي`,
    lines: [{ requestLineId: cashLine.id, rawMaterialItemId: raw.id, receivedQuantity: '2.00000000', receivedUnitId: kilogram.id, actualUnitPrice: '12.0000' }],
    idempotencyKey: randomUUID(),
  });

  const transferRequest = await execution.createPurchaseRequest(context, {
    businessDate,
    paymentChannel: 'BANK_TRANSFER',
    lines: [{ rawMaterialItemId: raw.id, requestedUnitId: kilogram.id, requestedQuantity: '1.00000000', quotedUnitPrice: '13.0000' }],
    idempotencyKey: randomUUID(),
  });
  const transferLine = await requestLine(execution, transferRequest.id);
  const transferReceipt = await execution.receivePurchaseRequest(context, {
    requestId: transferRequest.id,
    businessDate,
    paymentReference: `LIVE-TRX-${suffix}`,
    notes: `${marker} استلام تحويل بنكي`,
    lines: [{ requestLineId: transferLine.id, rawMaterialItemId: raw.id, receivedQuantity: '1.00000000', receivedUnitId: kilogram.id, actualUnitPrice: '13.0000' }],
    idempotencyKey: randomUUID(),
  });

  let workspace = await execution.workspace(context);
  assert.equal(workspace.inventory.find((row) => row.rawMaterialItemId === raw.id)?.baseQuantity, '6');
  assert.equal(workspace.custody.balance, '17');
  assert.equal(workspace.requests.find((request) => request.id === transferRequest.id)?.receipts[0]?.paymentReference, `LIVE-TRX-${suffix}`);

  const received = await execution.materialsReceivedReport(context, { from: '2026-08-01', to: '2026-08-31' });
  assert.ok(received.materials.some((item) => item.rawMaterialItemId === raw.id && item.quantity === '6'));
  const custodyReport = await execution.custodyMonthlyReport(context, { from: '2026-08-01', to: '2026-08-31' });
  assert.ok(custodyReport.months.some((month) => month.closingBalance === '17'));

  await execution.reversePurchaseReceipt(context, {
    receiptId: custodyReceipt.id,
    businessDate,
    idempotencyKey: randomUUID(),
  });
  workspace = await execution.workspace(context);
  assert.equal(workspace.inventory.find((row) => row.rawMaterialItemId === raw.id)?.baseQuantity, '3');
  assert.equal(workspace.custody.balance, '50');
  await execution.returnCustody(context, {
    requestId: custodyRequest.id,
    businessDate,
    amount: '50.0000',
    notes: `${marker} إقفال العهدة بعد الإلغاء`,
    idempotencyKey: randomUUID(),
  }, randomUUID());

  const section = await catalog.createSection(context, {
    code: `LIVE-GRILL-${suffix}`,
    nameAr: `${marker} قسم المشويات`,
    nameEn: `Live test grill ${suffix}`,
  }, randomUUID());
  const product = await catalog.createItem(context, {
    code: `LIVE-MENU-${suffix}`,
    nameAr: `${marker} طماطم مشوية`,
    nameEn: `Live test grilled tomato ${suffix}`,
    kind: 'MENU_PRODUCT',
    sectionId: section.id,
    baseUnitId: kilogram.id,
    unitPrices: [{ unitId: kilogram.id, menuSaleUnitPrice: '20.0000' }],
  }, randomUUID());
  await execution.publishRecipe(context, {
    outputItemId: product.id,
    outputUnitId: kilogram.id,
    outputQuantity: '1.00000000',
    lines: [{ rawMaterialItemId: raw.id, unitId: kilogram.id, quantity: '2.00000000' }],
    idempotencyKey: randomUUID(),
  });
  const workstation = await registrations.workstation(context);
  assert.ok(workstation.sections.some((item) => item.id === section.id));
  assert.ok(workstation.products.some((item) => item.id === product.id));
  const registration = await registrations.create(context, {
    businessDate,
    sectionId: section.id,
    lines: [{ menuProductItemId: product.id, unitId: kilogram.id, quantity: '1.00000000' }],
    idempotencyKey: randomUUID(),
  });
  const registrationReport = await registrations.report(context, { from: '2026-08-01', to: '2026-08-31' });
  assert.ok(registrationReport.totals.registrationCount >= 1);
  workspace = await execution.workspace(context);
  assert.equal(workspace.inventory.find((row) => row.rawMaterialItemId === raw.id)?.baseQuantity, '1');
  assert.equal(workspace.custody.balance, '0');

  console.log(JSON.stringify({
    status: 'passed', marker,
    records: {
      unitId: kilogram.id, rawItemId: raw.id, sectionId: section.id, menuProductId: product.id,
      custodyRequestId: custodyRequest.id, custodyReceiptId: custodyReceipt.id,
      cashRequestId: cashRequest.id, cashReceiptId: cashReceipt.id,
      bankTransferRequestId: transferRequest.id, bankTransferReceiptId: transferReceipt.id,
      internalRegistrationId: registration.id,
    },
    checks: ['purchase-custody', 'purchase-cash', 'purchase-bank-transfer', 'inventory-receipt', 'custody-return', 'receipt-reversal', 'recipe-publish', 'internal-registration', 'recipe-consumption'],
  }, null, 2));
} finally {
  await app?.close();
}

async function requestLine(execution, requestId) {
  const workspace = await execution.workspace(context);
  const line = workspace.requests.find((request) => request.id === requestId)?.lines[0];
  assert.ok(line, `Purchase request ${requestId} must expose its saved line.`);
  return line;
}
