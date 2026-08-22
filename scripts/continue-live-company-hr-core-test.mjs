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
const employeeId = '519f67e9-811e-4736-8d4f-c4fe21d27b74';
const businessDate = new Date('2026-08-22T00:00:00.000Z');
const marker = 'اختبار تشغيلي فعلي 2026-08-22';
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

  const document = await documents.create(context, employeeId, {
    documentType: 'OTHER',
    title: `${marker} مستند بيانات`,
    referenceNumber: 'LIVE-HR-DOC-001',
    notes: `${marker} مستند اختبار دون مرفق`,
    idempotencyKey: randomUUID(),
  });
  const letter = await letters.issue(context, employeeId, {
    letterType: 'SERVICE_CERTIFICATE',
    locale: 'ar',
    recipient: 'فريق الاختبار التشغيلي',
    idempotencyKey: randomUUID(),
  });
  const leave = await leaves.create(context, {
    employeeId,
    leaveType: 'OTHER',
    startDate: businessDate,
    endDate: businessDate,
    notes: `${marker} إجازة يوم اختبار`,
  }, randomUUID());
  const activeLeave = await leaves.detail(context, leave.id);
  assert.equal(activeLeave.leave.status, 'APPROVED');
  const returned = await leaves.returnEmployee(context, {
    leaveId: leave.id,
    returnDate: businessDate,
    notes: `${marker} عودة في اليوم نفسه`,
  }, randomUUID());
  const detail = await hr.employeeDetail(context, employeeId, { pageSize: 50 });
  const finalLeave = await leaves.detail(context, leave.id);
  assert.equal(detail.employee.jobTitle, 'مشرف تشغيل');
  assert.equal(finalLeave.leave.status, 'RETURNED');

  console.log(JSON.stringify({
    status: 'passed', marker,
    records: { employeeId, documentId: document.id, serviceCertificateId: letter.id, leaveId: leave.id, leaveReturnId: returned.id },
    checks: ['document-metadata', 'service-certificate', 'leave-approval', 'leave-return', 'employee-final-state'],
  }, null, 2));
} finally {
  await app?.close();
}
