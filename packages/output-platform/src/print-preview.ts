import type { ReportSnapshot } from './contracts.js';
import { escapeHtml, formatReportCell } from './formatting.js';

export function renderPrintPreviewDocument(snapshot: ReportSnapshot): string {
  const headers = snapshot.columns
    .map((column) => `<th>${escapeHtml(column.label)}</th>`)
    .join('');
  const rows = snapshot.rows
    .map((row) => {
      const cells = snapshot.columns
        .map((column) => `<td>${escapeHtml(String(formatReportCell(row[column.key] ?? null, column, snapshot.locale)))}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 landscape; margin: 14mm; }
    body { font-family: Arial, sans-serif; color: #17251f; font-size: 11px; }
    h1 { color: #176b4d; margin: 0 0 8px; font-size: 20px; }
    .meta { color: #52615b; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #176b4d; color: #fff; padding: 8px; text-align: inherit; }
    td { border-bottom: 1px solid #d9e3de; padding: 7px 8px; text-align: inherit; }
  </style></head><body><h1>${escapeHtml(snapshot.title)}</h1><div class="meta">${escapeHtml(snapshot.periodLabel)} · ${escapeHtml(snapshot.sourceLabel)} · ${escapeHtml(snapshot.generatedAtRiyadh)}</div><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
