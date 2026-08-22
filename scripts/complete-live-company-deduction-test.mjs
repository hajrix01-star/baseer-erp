import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = { tenantId: '6ffae759-800e-4653-8543-51013f5ef751', companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70', actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77' };
const deductionId = '195349fe-2f56-47fd-935d-7095f43aebd6';
let app;
try {
  const [{ AppModule }, { HrAdministrativeDeductionService }] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/hr/hr-administrative-deduction.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const deductions = app.get(HrAdministrativeDeductionService);
  await deductions.cancel(context, {
    deductionId,
    businessDate: new Date('2026-08-22T00:00:00.000Z'),
    reason: 'اختبار تشغيلي فعلي 2026-08-22 — إلغاء خصم قبل التسوية النهائية',
  }, randomUUID());
  const detail = await deductions.detail(context, deductionId, { actionPageSize: 20 });
  assert.equal(detail.deduction.status, 'CANCELLED');
  assert.equal(detail.deduction.remainingAmount, '0.0000');
  console.log(JSON.stringify({ status: 'passed', deductionId, checks: ['administrative-deduction-cancellation', 'remaining-balance-zero'] }, null, 2));
} finally {
  await app?.close();
}
