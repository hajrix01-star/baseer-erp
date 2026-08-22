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
const businessDate = new Date('2026-08-22T00:00:00.000Z');
const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
const marker = `اختبار تشغيلي فعلي 2026-08-22`;
let app;

try {
  const [
    { AppModule },
    { HrService },
    { HrLeaveService },
    { HrEmployeeDocumentService },
    { HrEmployeeLetterService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/hr/hr.service.js'),
    import('../apps/api/dist/hr/hr-leave.service.js'),
    import('../apps/api/dist/hr/hr-employee-document.service.js'),
    import('../apps/api/dist/hr/hr-employee-letter.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const hr = app.get(HrService);
  const leaves = app.get(HrLeaveService);
  const documents = app.get(HrEmployeeDocumentService);
  const letters = app.get(HrEmployeeLetterService);

  const employee = await hr.createEmployee(context, {
    nameAr: `${marker} موظف ${suffix}`,
    nameEn: `Live HR test employee ${suffix}`,
    jobTitle: 'مساعد تشغيل',
    phone: `050${suffix.slice(0, 7).replace(/[^0-9]/g, '1')}`,
    email: `live.hr.${suffix.toLowerCase()}@baseer.test`,
    hireDate: businessDate,
    notes: `${marker} — سجل اختبار الموارد البشرية`,
  }, randomUUID());

  const promotion = await hr.createPromotion(context, {
    employeeId: employee.id,
    effectiveDate: businessDate,
    newJobTitle: 'مشرف تشغيل',
    decisionReference: `LIVE-HR-PROMO-${suffix}`,
    reason: `${marker} ترقية اختبارية`,
  }, randomUUID());

  const service = await hr.createService(context, {
    employeeId: employee.id,
    serviceType: 'OTHER',
    referenceNumber: `LIVE-HR-SVC-${suffix}`,
    issueDate: businessDate,
    notes: `${marker} خدمة موظف بلا تكلفة مالية`,
  }, randomUUID());

  const document = await documents.create(context, employee.id, {
    documentType: 'OTHER',
    title: `${marker} مستند بيانات`,
    referenceNumber: `LIVE-HR-DOC-${suffix}`,
    issueDate: businessDate,
    notes: `${marker} مستند اختبار دون مرفق`,
    idempotencyKey: randomUUID(),
  });
  const letter = await letters.issue(context, employee.id, {
    letterType: 'SERVICE_CERTIFICATE',
    locale: 'ar',
    recipient: 'فريق الاختبار التشغيلي',
    idempotencyKey: randomUUID(),
  });

  const leave = await leaves.create(context, {
    employeeId: employee.id,
    leaveType: 'OTHER',
    startDate: businessDate,
    endDate: businessDate,
    notes: `${marker} إجازة يوم اختبار`,
  }, randomUUID());
  const leaveDuring = await leaves.detail(context, leave.id);
  assert.equal(leaveDuring.leave.status, 'APPROVED');
  const returned = await leaves.returnEmployee(context, {
    leaveId: leave.id,
    returnDate: businessDate,
    notes: `${marker} عودة في اليوم نفسه`,
  }, randomUUID());

  const detail = await hr.employeeDetail(context, employee.id, { pageSize: 50 });
  assert.equal(detail.employee.jobTitle, 'مشرف تشغيل');
  assert.ok(detail.services.some((item) => item.id === service.id));
  const leaveAfter = await leaves.detail(context, leave.id);
  assert.equal(leaveAfter.leave.status, 'RETURNED');

  console.log(JSON.stringify({
    status: 'passed', marker,
    records: {
      employeeId: employee.id,
      promotionId: promotion.id,
      serviceId: service.id,
      documentId: document.id,
      serviceCertificateId: letter.id,
      leaveId: leave.id,
      leaveReturnId: returned.id,
    },
    checks: ['employee-create', 'promotion', 'employee-service', 'document-metadata', 'service-certificate', 'leave-approval', 'leave-return'],
  }, null, 2));
} finally {
  await app?.close();
}
