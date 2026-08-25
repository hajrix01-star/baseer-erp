/**
 * Interactive reports return an immediate, live response.  Their source data
 * must therefore remain bounded; an official ReportRun is the deliberate path
 * for larger, immutable output.
 */
export const INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS = 24;
export const INTERACTIVE_REPORT_MAX_SOURCE_LINES = 10_000;

export function interactiveReportPeriodMessage(from: Date, to: Date, months?: readonly string[]): string | null {
  // Explicit month selection is already capped by the public contracts. It is
  // queried as individual month ranges rather than as the envelope dates.
  if (months?.length) return months.length <= INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS
    ? null
    : `لا يدعم العرض التفاعلي أكثر من ${INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS} شهراً محدداً في الطلب الواحد.`;

  const monthsInRange = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1;
  return monthsInRange <= INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS
    ? null
    : `الفترة المطلوبة أطول من حد العرض التفاعلي (${INTERACTIVE_REPORT_MAX_CALENDAR_MONTHS} شهراً). اختر فترة أقصر أو أنشئ مخرجاً رسمياً.`;
}

export function interactiveReportSourceMessage(sourceLineCount: number): string | null {
  return sourceLineCount <= INTERACTIVE_REPORT_MAX_SOURCE_LINES
    ? null
    : `تحتوي الفترة المحددة على أكثر من ${INTERACTIVE_REPORT_MAX_SOURCE_LINES.toLocaleString('en-US')} حركة مصدر. اختر فترة أقصر أو أنشئ مخرجاً رسمياً.`;
}
