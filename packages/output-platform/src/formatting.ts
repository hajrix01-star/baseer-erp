import type { ReportColumn, ReportLocale } from './contracts.js';

const formulaPrefix = /^[=+\-@]/;

export function safeCellText(value: string): string {
  return formulaPrefix.test(value) ? `'${value}` : value;
}

export function formatReportCell(
  value: string | number | null,
  column: ReportColumn,
  locale: ReportLocale,
): string | number {
  if (value === null) return '';
  if (typeof value === 'string') return safeCellText(value);

  if (column.kind === 'amount') {
    return new Intl.NumberFormat(locale === 'ar' ? 'en-US' : 'en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
      useGrouping: true,
    }).format(value);
  }

  if (column.kind === 'percent') {
    return new Intl.NumberFormat(locale === 'ar' ? 'en-US' : 'en-US', {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
      useGrouping: true,
    }).format(value);
  }

  return value;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
