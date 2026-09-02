import assert from 'node:assert/strict';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const TARGETS = Object.freeze([
  { code: 'ARZ', companyId: '7e64301f-c87e-4d98-9881-35328ace117b' },
  { code: 'AL_SHAMI', companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70' },
]);
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const APPLY_CONFIRMATION = 'APPLY_BASELINE_PNL_MAPPINGS';
const apply = process.argv.includes(`--confirm=${APPLY_CONFIRMATION}`);

let app;
try {
  const [{ AppModule }, { DatabaseService }, { FinancePnlMappingService }] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-pnl-mapping.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const mappings = app.get(FinancePnlMappingService);
  const receipts = [];

  for (const target of TARGETS) {
    const source = await database.inTenantTransaction(TENANT_ID, (transaction) => transaction.company.findUnique({
      where: { id: target.companyId },
      select: {
        id: true,
        tenantId: true,
        nameAr: true,
        memberships: { where: { role: { code: 'BASEER_COMPANY_MANAGER' } }, take: 1, select: { userId: true } },
        financeAccounts: {
          where: { status: 'ACTIVE', type: { in: ['REVENUE', 'EXPENSE'] } },
          orderBy: [{ type: 'desc' }, { code: 'asc' }],
          select: { id: true, code: true, nameAr: true, nameEn: true, type: true },
        },
        pnlMappingVersions: {
          where: { status: 'APPROVED' },
          include: { accountMappings: { select: { accountId: true } } },
          orderBy: { versionNumber: 'desc' },
          take: 1,
        },
      },
    }));
    assert(source, `Company ${target.code} was not found.`);
    assert(source.memberships[0], `Company ${target.code} needs a manager to own the mapping audit trail.`);
    assert(source.financeAccounts.length > 0, `Company ${target.code} has no active revenue/expense accounts.`);

    const approved = source.pnlMappingVersions[0];
    if (approved) {
      const mapped = new Set(approved.accountMappings.map((item) => item.accountId));
      const missing = source.financeAccounts.filter((account) => !mapped.has(account.id));
      assert.equal(missing.length, 0, `Approved mapping ${approved.id} for ${target.code} is incomplete.`);
      receipts.push({ code: target.code, company: source.nameAr, action: 'REUSED', mappingVersionId: approved.id, accountCount: mapped.size });
      continue;
    }

    const ordered = [...source.financeAccounts].sort((left, right) => accountRank(left) - accountRank(right) || left.code.localeCompare(right.code));
    const input = {
      effectiveFrom: new Date('1900-01-01T00:00:00.000Z'),
      effectiveTo: null,
      lines: ordered.map((account, index) => ({
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn || account.nameAr,
        presentationNature: nature(account),
        sortOrder: (index + 1) * 10,
      })),
      accountMappings: ordered.map((account) => ({
        accountId: account.id,
        statementLineCode: account.code,
        presentationSign: account.type === 'REVENUE' ? 'CREDIT_NATURE' : 'DEBIT_NATURE',
      })),
    };
    if (!apply) {
      receipts.push({ code: target.code, company: source.nameAr, action: 'DRY_RUN', accountCount: ordered.length, lines: input.lines.map((line) => ({ code: line.code, nature: line.presentationNature })) });
      continue;
    }
    const context = { tenantId: source.tenantId, companyId: source.id, actorUserId: source.memberships[0].userId };
    const receipt = await mappings.createDraft(context, input);
    await mappings.approveDraft(context, receipt.id);
    const verified = await database.inTenantTransaction(source.tenantId, (transaction) => transaction.financePnlMappingVersion.findFirst({
      where: { id: receipt.id, tenantId: source.tenantId, companyId: source.id, status: 'APPROVED' },
      include: { statementLines: true, accountMappings: true },
    }));
    assert(verified?.checksum, `Approved mapping ${receipt.id} for ${target.code} has no checksum.`);
    assert.equal(verified.accountMappings.length, ordered.length);
    assert.equal(verified.statementLines.length, ordered.length);
    receipts.push({ code: target.code, company: source.nameAr, action: 'CREATED_AND_APPROVED', mappingVersionId: receipt.id, versionNumber: receipt.versionNumber, checksum: verified.checksum, accountCount: ordered.length });
  }

  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', confirmationRequired: apply ? null : APPLY_CONFIRMATION, receipts }, null, 2));
} finally {
  await app?.close();
}

function accountRank(account) {
  if (account.type === 'REVENUE' && account.code === 'REV-001') return 10;
  if (account.type === 'REVENUE') return 20;
  if (account.code.startsWith('PUR-')) return 30;
  return 40;
}
function nature(account) {
  if (account.type === 'REVENUE' && account.code === 'REV-001') return 'REVENUE';
  if (account.type === 'REVENUE') return 'OPERATING_INCOME';
  if (account.code.startsWith('PUR-')) return 'COST_OF_SALES';
  return 'OPERATING_EXPENSE';
}
