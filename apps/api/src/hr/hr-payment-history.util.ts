import { latestHrBusinessDate } from './hr-financial-date.util.js';

type HrPaymentHistoryRow = Readonly<{
  businessDate: Date;
  journalEntry: Readonly<{
    reversalEntry: Readonly<{ businessDate: Date }> | null;
  }>;
}>;

type HrPaymentReversalProjection = Readonly<{ id: string; postedAt: Date }> | null;

/** Latest immutable payment event, including a later reversal of any payment. */
export function latestHrPaymentEventDate(payments: readonly HrPaymentHistoryRow[]): Date | null {
  return payments.reduce<Date | null>(
    (latest, payment) => latestHrBusinessDate(latest, payment.businessDate, payment.journalEntry.reversalEntry?.businessDate),
    null,
  );
}

/** Payment rows remain immutable; their public posting state comes from the journal reversal link. */
export function hrPaymentPostingProjection(reversalEntry: HrPaymentReversalProjection) {
  return {
    status: reversalEntry ? 'REVERSED' as const : 'POSTED' as const,
    reversedAt: reversalEntry?.postedAt.toISOString() ?? null,
    reversalJournalEntryId: reversalEntry?.id ?? null,
  };
}
