import assert from 'node:assert/strict';

import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinancePnlPresentationNature,
  FinancePnlPresentationSign,
} from '../generated/prisma/client.js';
import { validatePnlMappingDraft } from './finance-pnl-mapping.service.js';

const revenueId = '11111111-1111-4111-8111-111111111111';
const expenseId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';

const lines = [
  { code: 'REVENUE', nameAr: 'الإيرادات', nameEn: 'Revenue', presentationNature: FinancePnlPresentationNature.REVENUE, sortOrder: 10 },
  { code: 'COST_OF_SALES', nameAr: 'تكلفة المبيعات', nameEn: 'Cost of sales', presentationNature: FinancePnlPresentationNature.COST_OF_SALES, sortOrder: 20 },
] as const;
const accounts = [
  { id: revenueId, type: FinanceAccountType.REVENUE, status: FinanceAccountStatus.ACTIVE },
  { id: expenseId, type: FinanceAccountType.EXPENSE, status: FinanceAccountStatus.ACTIVE },
  { id: assetId, type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE },
] as const;
const validMappings = [
  { accountId: revenueId, statementLineCode: 'REVENUE', presentationSign: FinancePnlPresentationSign.CREDIT_NATURE },
  { accountId: expenseId, statementLineCode: 'COST_OF_SALES', presentationSign: FinancePnlPresentationSign.DEBIT_NATURE },
] as const;

validatePnlMappingDraft(lines, validMappings, accounts);
assert.throws(() => validatePnlMappingDraft(lines, [...validMappings, { accountId: assetId, statementLineCode: 'REVENUE', presentationSign: FinancePnlPresentationSign.CREDIT_NATURE }], accounts), /Only revenue and expense accounts/);
assert.throws(() => validatePnlMappingDraft(lines, [validMappings[0]], accounts), /Every active revenue and expense account/);
assert.throws(() => validatePnlMappingDraft(lines, [validMappings[0], { accountId: revenueId, statementLineCode: 'REVENUE', presentationSign: FinancePnlPresentationSign.CREDIT_NATURE }], accounts), /only once/);

console.log('R0-A P&L mapping policy verification passed.');
