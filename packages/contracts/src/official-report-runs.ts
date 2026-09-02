import { z } from 'zod';

import { accrualProfitLossRequestSchema } from './accrual-profit-loss.js';
import { internalVatReportRequestSchema } from './internal-vat-report.js';
import { ledgerTrialBalanceRequestSchema } from './ledger-trial-balance.js';
import { personalCashPerformanceRequestSchema } from './reporting.js';

/**
 * A run is an immutable source boundary for an official output, never the
 * cache mechanism for the interactive report screen.
 */
export const officialReportRunRequestSchema = z.discriminatedUnion('reportCode', [
  z.object({ reportCode: z.literal('accrual_profit_loss'), purpose: z.enum(['evidence', 'preview', 'xlsx', 'save']), request: accrualProfitLossRequestSchema }).strict(),
  z.object({ reportCode: z.literal('personal_cash_performance'), purpose: z.enum(['evidence', 'preview', 'xlsx', 'save']), request: personalCashPerformanceRequestSchema }).strict(),
  z.object({ reportCode: z.literal('ledger_trial_balance'), purpose: z.enum(['evidence', 'preview', 'xlsx', 'save']), request: ledgerTrialBalanceRequestSchema }).strict(),
  z.object({ reportCode: z.literal('internal_vat_report'), purpose: z.enum(['evidence', 'preview', 'xlsx', 'save']), request: internalVatReportRequestSchema }).strict(),
]);

export const officialReportRunReceiptSchema = z.object({
  reportRunId: z.string().uuid(),
  reportCode: z.enum(['accrual_profit_loss', 'personal_cash_performance', 'ledger_trial_balance', 'internal_vat_report']),
  definitionVersion: z.string().min(1).max(80),
  ledgerRevision: z.string().regex(/^\d+$/),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string().datetime(),
}).strict();

export type OfficialReportRunRequest = z.infer<typeof officialReportRunRequestSchema>;
export type OfficialReportRunReceipt = z.infer<typeof officialReportRunReceiptSchema>;
