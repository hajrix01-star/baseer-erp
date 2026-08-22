import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = { tenantId: '6ffae759-800e-4653-8543-51013f5ef751', companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70', actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77' };
let app;
try {
  const [{ AppModule }, { DatabaseService }, { FinancePeriodLifecycleService }] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-period-lifecycle.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const periods = app.get(FinancePeriodLifecycleService);
  const start = new Date('2026-08-18T00:00:00.000Z');
  const end = new Date('2026-08-21T00:00:00.000Z');
  const existing = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeFiscalPeriod.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, startDate: { lte: start }, endDate: { gte: end } }, select: { id: true } }));
  const periodId = existing?.id ?? await periods.createOpenPeriod(context, { nameAr: 'فترة استكمال تقويم الاختبار 18–21 أغسطس 2026', nameEn: 'Test calendar completion 18-21 Aug 2026', startDate: start, endDate: end });
  const allPeriods = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeFiscalPeriod.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: { startDate: 'asc' }, select: { id: true, startDate: true, endDate: true, status: true } }));
  console.log(JSON.stringify({ status: 'passed', periodId, periods: allPeriods.map((item) => ({ id: item.id, start: item.startDate.toISOString().slice(0, 10), end: item.endDate.toISOString().slice(0, 10), status: item.status })) }, null, 2));
} finally {
  await app?.close();
}
