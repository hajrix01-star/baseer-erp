import * as XLSX from 'xlsx';

import type { OutputArtifact, ReportSnapshot } from './contracts.js';
import { formatReportCell } from './formatting.js';

function buildFileName(snapshot: ReportSnapshot): string {
  const safeReportCode = snapshot.reportCode.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeReportCode}-${snapshot.snapshotId}.xlsx`;
}

export async function renderExcel(snapshot: ReportSnapshot): Promise<OutputArtifact> {
  const columnCount = Math.max(snapshot.columns.length, 1);
  const rows = [
    [snapshot.title],
    [`${snapshot.periodLabel} \u2022 ${snapshot.sourceLabel}`],
    [snapshot.companies.map((company) => company.name).join('\u060C ')],
    [],
    snapshot.columns.map((column) => column.label),
    ...snapshot.rows.map((reportRow) =>
      snapshot.columns.map((column) => formatReportCell(reportRow[column.key] ?? null, column, snapshot.locale)),
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const lastColumn = XLSX.utils.encode_cell({ r: 0, c: columnCount - 1 }).replace(/\d+$/, '');

  worksheet['!merges'] = [1, 2, 3].map((row) => XLSX.utils.decode_range(`A${row}:${lastColumn}${row}`));
  worksheet['!cols'] = snapshot.columns.map((column) => ({ wch: column.width ?? 18 }));
  worksheet['!pageSetup'] = { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 };

  const workbook = XLSX.utils.book_new();
  workbook.Props = { Author: 'Baseer ERP', CreatedDate: new Date(snapshot.generatedAtRiyadh) };
  workbook.Workbook = { Views: [{ RTL: snapshot.direction === 'rtl' }] };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');

  const bytes = new Uint8Array(XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true }));
  return {
    snapshotId: snapshot.snapshotId,
    format: 'xlsx',
    fileName: buildFileName(snapshot),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes,
  };
}