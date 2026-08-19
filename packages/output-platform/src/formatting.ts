import type { ReportColumn, ReportLocale } from './contracts.js';

const formulaPrefix = /^[=+\-@]/;

export function safeCellText(value: string): string {
  return formulaPrefix.test(value) ? `'${value}` : value;
}

/**
 * Presentation-only number formatting shared by reports, print documents and UI.
 * Financial values retain their full Decimal precision in the API and database.
 */
export function formatDisplayNumber(value: string | number): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return typeof value === 'string' ? safeCellText(value) : '';

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(numeric);
}

export function formatReportCell(
  value: string | number | null,
  column: ReportColumn,
  locale: ReportLocale,
): string | number {
  if (value === null) return '';

  if (column.kind === 'amount') {
    return formatDisplayNumber(value);
  }

  if (column.kind === 'percent') {
    return formatDisplayNumber(value);
  }

  if (typeof value === 'string') return safeCellText(value);
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
