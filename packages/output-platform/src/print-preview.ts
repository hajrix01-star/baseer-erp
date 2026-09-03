import type { ReportSnapshot } from './contracts.js';
import { escapeHtml, formatDisplayNumber, formatReportCell } from './formatting.js';

/** Renders report content only. It deliberately never clones the interactive application UI. */
export function renderPrintPreviewDocument(snapshot: ReportSnapshot): string {
  if (snapshot.template === 'payroll-signature-slips') return renderPayrollSignatureSlips(snapshot);
  if (snapshot.template === 'payroll-run') return renderPayrollRun(snapshot);
  if (snapshot.template === 'attendance-weekly-roster') return renderAttendanceWeeklyRoster(snapshot);
  if (snapshot.reportCode === 'personal_cash_performance') return renderFinancialPerformance(snapshot);
  const headers = snapshot.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const rows = snapshot.rows.map((row) => `<tr>${snapshot.columns.map((column) => `<td>${escapeHtml(String(formatReportCell(row[column.key] ?? null, column, snapshot.locale)))}</td>`).join('')}</tr>`).join('');
  const companyNames = snapshot.companies.map((company) => company.name).join(snapshot.locale === 'ar' ? '، ' : ', ');
  const logo = snapshot.companyLogoDataUri
    ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(companyNames)}">`
    : '<div class="brand-mark" aria-hidden="true">B</div>';
  const periodLabel = snapshot.locale === 'ar' ? 'الفترة' : 'Period';
  const sourceLabel = snapshot.locale === 'ar' ? 'مصدر البيانات' : 'Data source';
  const generatedLabel = snapshot.locale === 'ar' ? 'وقت الإنشاء' : 'Generated at';
  const verified = snapshot.locale === 'ar' ? 'مستند مُنشأ من بيانات خادمية موثقة' : 'Document generated from verified server data';
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 landscape; margin: 13mm 14mm 15mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Noto Sans Arabic", sans-serif; color: #152b22; font-size: 11px; line-height: 1.45; }
    .report-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding-bottom: 12px; border-bottom: 2px solid #0b7651; }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .brand-logo { display: block; width: 42px; height: 42px; object-fit: contain; }
    .brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 10px; background: #0b7651; color: #fff; font-size: 25px; font-weight: 800; }
    .company-name { margin: 0; color: #0b7651; font-size: 15px; font-weight: 800; }
    .report-kind { margin: 2px 0 0; color: #63736c; font-size: 10px; }
    h1 { margin: 0; color: #152b22; font-size: 22px; line-height: 1.2; }
    .report-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 15px 0; }
    .meta-item { padding: 8px 10px; border: 1px solid #d9e4de; border-radius: 7px; background: #f8fbf9; }
    .meta-label { display: block; margin-bottom: 2px; color: #63736c; font-size: 9px; }
    .meta-value { font-weight: 700; color: #19362a; }
    table { width: 100%; border-collapse: collapse; border: 1px solid #d9e4de; }
    th { padding: 8px 9px; background: #0b7651; color: #fff; font-size: 10px; font-weight: 700; text-align: inherit; }
    td { padding: 8px 9px; border-bottom: 1px solid #e4ece7; text-align: inherit; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f8fbf9; }
    .report-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 13px; padding-top: 8px; border-top: 1px solid #d9e4de; color: #63736c; font-size: 9px; }
    @media print { .report-header, .report-meta, tr { break-inside: avoid; } }
  </style></head><body><header class="report-header"><div class="brand">${logo}<div><p class="company-name">${escapeHtml(companyNames)}</p><p class="report-kind">Baseer ERP</p></div></div><h1>${escapeHtml(snapshot.title)}</h1></header><section class="report-meta"><div class="meta-item"><span class="meta-label">${periodLabel}</span><span class="meta-value">${escapeHtml(snapshot.periodLabel)}</span></div><div class="meta-item"><span class="meta-label">${sourceLabel}</span><span class="meta-value">${escapeHtml(snapshot.sourceLabel)}</span></div><div class="meta-item"><span class="meta-label">${generatedLabel}</span><span class="meta-value">${escapeHtml(snapshot.generatedAtRiyadh)}</span></div></section><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table><footer class="report-footer"><span>${verified}</span><span>${escapeHtml(snapshot.reportCode)} · ${escapeHtml(snapshot.snapshotId)}</span></footer></body></html>`;
}

/** Central A4 landscape attendance board. Rows paginate naturally and the
 * table header repeats on every page, making it practical as an office copy. */
function renderAttendanceWeeklyRoster(snapshot: ReportSnapshot): string {
  const roster = snapshot.attendanceWeeklyRoster;
  if (!roster) throw new Error('Attendance weekly roster data is missing.');
  const ar = snapshot.locale === 'ar';
  const company = snapshot.companies.map((item) => item.name).join(ar ? '، ' : ', ');
  const logo = snapshot.companyLogoDataUri ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(company)}">` : '<div class="brand-mark" aria-hidden="true">B</div>';
  const dayHeaders = roster.days.map((day) => `<th><span>${escapeHtml(day.label)}</span><small dir="ltr">${escapeHtml(day.date.slice(5))}</small></th>`).join('');
  const cell = (day: (typeof roster.rows)[number]['days'][number]) => {
    if (day.kind === 'LEAVE') return `<td class="leave"><b>${escapeHtml(day.label)}</b></td>`;
    if (day.kind === 'REST') return `<td class="rest"><b>${escapeHtml(day.label)}</b></td>`;
    if (day.kind === 'OFF') return `<td class="off"><b>${escapeHtml(day.label)}</b></td>`;
    const shifts = day.periods.map((period) => `<span class="shift" dir="ltr">${escapeHtml(period.startTime)}–${escapeHtml(period.endTime)}${period.endsNextDay ? '<sup>+1</sup>' : ''}</span>`).join('');
    return `<td class="work">${shifts || `<b>${escapeHtml(day.label)}</b>`}</td>`;
  };
  const rows = roster.rows.map((row) => `<tr><th scope="row"><b>${escapeHtml(row.employeeName)}</b><small dir="ltr">${escapeHtml(row.employeeNumber)}</small>${row.jobTitle ? `<em>${escapeHtml(row.jobTitle)}</em>` : ''}</th>${row.days.map(cell).join('')}</tr>`).join('');
  const legend = ar ? 'دوام' : 'Work'; const leave = ar ? 'إجازة' : 'Leave'; const rest = ar ? 'راحة' : 'Rest'; const off = ar ? 'غير مجدول' : 'Off';
  const verified = ar ? 'جدول صادر من لقطة خادمية موثقة في بصير' : 'Schedule issued from a verified Baseer server snapshot';
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 landscape; margin: 10mm 9mm 12mm; } * { box-sizing:border-box; } body { margin:0; color:#173428; font-family:Arial,"Noto Sans Arabic",sans-serif; font-size:8.5px; line-height:1.35; }
    .header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding-bottom:8px; border-bottom:2px solid #0b7651; }.brand { display:flex; align-items:center; gap:8px; }.brand-logo,.brand-mark { width:32px; height:32px; object-fit:contain; }.brand-mark { display:grid; place-items:center; border-radius:8px; background:#0b7651; color:#fff; font-size:18px; font-weight:800; }.company { margin:0; color:#0b7651; font-size:12px; font-weight:800; }.system { margin:1px 0 0; color:#63736c; font-size:8px; }.title { text-align:end; }.title h1 { margin:0; font-size:17px; }.title p { margin:2px 0 0; color:#63736c; font-size:8px; }
    .meta { display:flex; justify-content:space-between; gap:8px; margin:7px 0; color:#52675e; font-size:8px; }.legend { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }.key { display:inline-flex; gap:3px; align-items:center; }.key i { width:8px; height:8px; border-radius:2px; background:#caeee0; border:1px solid #66b997; }.key.leave i { background:#f9ddd6; border-color:#dc8a77; }.key.rest i { background:#f5e9bd; border-color:#cba941; }.key.off i { background:#eef0ef; border-color:#b9c2bd; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; border:1px solid #cfe0d7; } thead { display:table-header-group; } th,td { border:1px solid #dce8e2; padding:5px 4px; text-align:center; vertical-align:middle; } thead th { background:#0b7651; color:#fff; font-size:8px; } thead th:first-child { width:25%; text-align:inherit; } thead small { display:block; margin-top:1px; font-size:7px; opacity:.88; } tbody th { background:#f8fbf9; text-align:inherit; font-weight:600; } tbody th b,tbody th small,tbody th em { display:block; } tbody th small { margin-top:1px; color:#617269; font-size:7px; } tbody th em { margin-top:1px; color:#788980; font-size:7px; font-style:normal; }.work { background:#f4fbf7; }.shift { display:block; margin:2px 0; padding:2px 3px; border-radius:3px; background:#caeee0; color:#075f3f; font-size:7.4px; font-weight:800; white-space:nowrap; }.shift sup { margin-inline-start:1px; color:#8a5526; }.leave { background:#fff0ec; color:#9d3320; }.rest { background:#fff9df; color:#755b00; }.off { background:#f4f6f5; color:#68776f; }.leave b,.rest b,.off b { font-size:8px; }.footer { display:flex; justify-content:space-between; gap:10px; margin-top:7px; padding-top:5px; border-top:1px solid #d6e4dc; color:#63736c; font-size:7px; } @media print { tr { break-inside:avoid; } }
  </style></head><body><main><header class="header"><div class="brand">${logo}<div><p class="company">${escapeHtml(company)}</p><p class="system">Baseer ERP</p></div></div><div class="title"><h1>${escapeHtml(snapshot.title)}</h1><p>${escapeHtml(snapshot.periodLabel)}</p></div></header><section class="meta"><div class="legend"><span class="key"><i></i>${legend}</span><span class="key leave"><i></i>${leave}</span><span class="key rest"><i></i>${rest}</span><span class="key off"><i></i>${off}</span></div><span>${escapeHtml(snapshot.generatedAtRiyadh)}</span></section><table><thead><tr><th>${ar ? 'الموظف' : 'Employee'}</th>${dayHeaders}</tr></thead><tbody>${rows}</tbody></table><footer class="footer"><span>${verified}</span><span dir="ltr">${escapeHtml(snapshot.reportCode)} · ${escapeHtml(snapshot.snapshotId)}</span></footer></main></body></html>`;
}

/**
 * The owner's financial-performance report is intentionally compact. It is a
 * printed form of the report canvas, not a stretched generic spreadsheet.
 */
/** A deliberately restrained paper version of the on-screen financial report. */
function renderFinancialPerformance(snapshot: ReportSnapshot): string {
  const ar = snapshot.locale === 'ar';
  const company = snapshot.companies.map((item) => item.name).join(ar ? '، ' : ', ');
  const itemColumn = snapshot.columns.find((column) => column.key === 'item')?.label ?? (ar ? 'البند' : 'Item');
  const amountColumn = snapshot.columns.find((column) => column.key === 'amount')?.label ?? (ar ? 'المبلغ' : 'Amount');
  const rows = snapshot.rows.map((row) => {
    const kind = row['kind'] === 'total' ? 'total' : row['kind'] === 'section' ? 'section' : 'line';
    const amount = formatReportCell(row['amount'] ?? null, { key: 'amount', label: amountColumn, kind: 'amount' }, snapshot.locale);
    return `<div class="report-row ${kind}"><span>${escapeHtml(String(row['item'] ?? ''))}</span><b dir="ltr">${escapeHtml(String(amount))}</b></div>`;
  }).join('');
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 portrait; margin: 20mm 28mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #173428; font-family: Arial, "Noto Sans Arabic", sans-serif; font-size: 11px; line-height: 1.45; }
    .document { width: 100%; max-width: 136mm; margin: 0 auto; }
    .header { padding: 0 0 12px; border-bottom: 1px solid #a9c7b8; }
    .company { margin: 0 0 4px; color: #087c53; font-size: 10px; font-weight: 800; }
    h1 { margin: 0; color: #163326; font-size: 20px; line-height: 1.25; }
    .period { margin: 5px 0 0; color: #66776e; font-size: 10px; }
    .report-columns { display: grid; grid-template-columns: 1fr 31mm; gap: 12px; margin: 16px 0 4px; color: #6b7c72; font-size: 9px; font-weight: 800; }
    .report-columns span:last-child { text-align: end; }
    .report-list { border-top: 1px solid #d4e2da; }
    .report-row { display: grid; grid-template-columns: 1fr 31mm; gap: 12px; align-items: center; min-height: 31px; padding: 7px 9px; border-bottom: 1px solid #dce7e1; }
    .report-row b { text-align: end; color: #17392b; font-size: 11px; font-weight: 650; font-variant-numeric: tabular-nums; }
    .report-row.section { margin-top: 4px; min-height: 32px; border-bottom: 0; background: #deeee7; color: #075f3f; font-weight: 800; }
    .report-row.section b { color: #087653; font-weight: 800; }
    .report-row.total { margin-top: 12px; min-height: 42px; padding: 9px 10px; border-top: 2px solid #087c53; border-bottom: 0; background: #f4faf7; color: #0b5038; font-size: 12px; font-weight: 900; }
    .report-row.total b { color: #07563a; font-size: 14px; font-weight: 900; }
    .footer { margin-top: 12px; color: #7a897f; font-size: 8px; text-align: center; }
    @media print { .report-row { break-inside: avoid; } }
  </style></head><body><main class="document"><header class="header"><p class="company">${escapeHtml(company)} · Baseer ERP</p><h1>${escapeHtml(snapshot.title)}</h1><p class="period">${escapeHtml(snapshot.periodLabel)}</p></header><div class="report-columns"><span>${escapeHtml(itemColumn)}</span><span>${escapeHtml(amountColumn)}</span></div><section class="report-list">${rows}</section><footer class="footer">${ar ? 'تقرير مُنشأ من بيانات النظام' : 'Report generated from system data'}</footer></main></body></html>`;
}

function renderFinancialPerformanceLegacy(snapshot: ReportSnapshot): string {
  const ar = snapshot.locale === 'ar';
  const company = snapshot.companies.map((item) => item.name).join(ar ? '، ' : ', ');
  const logo = snapshot.companyLogoDataUri
    ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(company)}">`
    : '<div class="brand-mark" aria-hidden="true">B</div>';
  const itemColumn = snapshot.columns.find((column) => column.key === 'item')?.label ?? (ar ? 'البند' : 'Item');
  const amountColumn = snapshot.columns.find((column) => column.key === 'amount')?.label ?? (ar ? 'المبلغ' : 'Amount');
  const rows = snapshot.rows.map((row) => {
    const kind = row['kind'] === 'total' ? ' total' : row['kind'] === 'section' ? ' section' : '';
    const amount = formatReportCell(row['amount'] ?? null, { key: 'amount', label: amountColumn, kind: 'amount' }, snapshot.locale);
    return `<tr class="${kind.trim()}"><th scope="row">${escapeHtml(String(row['item'] ?? ''))}</th><td dir="ltr">${escapeHtml(String(amount))}</td></tr>`;
  }).join('');
  const period = ar ? 'الفترة' : 'Period';
  const generated = ar ? 'وقت الإنشاء' : 'Generated at';
  const source = ar ? 'أساس التقرير' : 'Report basis';
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 portrait; margin: 13mm 16mm 15mm; }
    * { box-sizing: border-box; }
    body { margin:0; background:#fff; color:#173428; font-family:Arial,"Noto Sans Arabic",sans-serif; font-size:11px; line-height:1.45; }
    .document { width:100%; max-width:182mm; margin:0 auto; }
    .header { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:0 0 10px; border-bottom:2px solid #087c53; }
    .brand { display:flex; align-items:center; gap:9px; min-width:0; }.brand-logo,.brand-mark { width:34px; height:34px; object-fit:contain; }.brand-mark { display:grid; place-items:center; border-radius:8px; background:#087c53; color:#fff; font-weight:800; font-size:19px; }
    .company { margin:0; color:#087c53; font-size:12px; font-weight:800; }.system { margin:2px 0 0; color:#708177; font-size:8px; }.title { text-align:end; }.title h1 { margin:0; font-size:19px; line-height:1.2; }.title p { margin:3px 0 0; color:#65766d; font-size:9px; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; margin:11px 0; }.meta div { min-width:0; padding:6px 8px; border:1px solid #d8e4de; border-radius:6px; background:#fafcfb; }.meta .source { grid-column:1 / -1; }.meta span { display:block; margin-bottom:1px; color:#718279; font-size:8px; }.meta b { display:block; color:#254237; font-size:9px; font-weight:700; overflow-wrap:anywhere; }
    table { width:100%; border-collapse:collapse; border:1px solid #d5e1db; border-radius:7px; overflow:hidden; } thead { display:table-header-group; } th,td { padding:8px 10px; border-bottom:1px solid #dbe6e0; text-align:inherit; } thead th { background:#eef5f1; color:#65766d; font-size:9px; font-weight:800; } thead th:last-child, tbody td { width:30%; text-align:end; font-variant-numeric:tabular-nums; } tbody th { color:#18392c; font-weight:600; } tbody tr.section th, tbody tr.section td { background:#dfeee8; color:#075f3f; font-weight:800; } tbody tr.total th, tbody tr.total td { padding-top:10px; padding-bottom:10px; border-top:2px solid #087c53; border-bottom:0; background:#f5faf7; color:#0b5038; font-size:12px; font-weight:900; } tbody tr:last-child th, tbody tr:last-child td { border-bottom:0; }
    .footer { display:flex; justify-content:space-between; gap:12px; margin-top:10px; padding-top:7px; border-top:1px solid #d8e4de; color:#718279; font-size:8px; } @media print { .header,.meta,tr { break-inside:avoid; } }
  </style></head><body><main class="document"><header class="header"><div class="brand">${logo}<div><p class="company">${escapeHtml(company)}</p><p class="system">Baseer ERP</p></div></div><div class="title"><h1>${escapeHtml(snapshot.title)}</h1><p>${escapeHtml(snapshot.periodLabel)}</p></div></header><section class="meta"><div><span>${period}</span><b dir="ltr">${escapeHtml(snapshot.periodLabel)}</b></div><div><span>${generated}</span><b dir="ltr">${escapeHtml(snapshot.generatedAtRiyadh)}</b></div><div class="source"><span>${source}</span><b>${escapeHtml(snapshot.sourceLabel)}</b></div></section><table><thead><tr><th>${escapeHtml(itemColumn)}</th><th>${escapeHtml(amountColumn)}</th></tr></thead><tbody>${rows}</tbody></table><footer class="footer"><span>${ar ? 'مستند خادمي ثابت من لقطة التقرير' : 'Server-built immutable report snapshot'}</span><span dir="ltr">${escapeHtml(snapshot.snapshotId)}</span></footer></main></body></html>`;
}

/** Payroll is a formal A4 document, not a copy of the application data table. */
function renderPayrollRun(snapshot: ReportSnapshot): string {
  const ar = snapshot.locale === 'ar';
  const company = snapshot.companies.map((item) => item.name).join(ar ? '، ' : ', ');
  const logo = snapshot.companyLogoDataUri
    ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(company)}">`
    : '<div class="brand-mark" aria-hidden="true">B</div>';
  const label = (key: string, fallback: string) => snapshot.columns.find((column) => column.key === key)?.label ?? fallback;
  const number = (value: string | number | null | undefined) => Number(value ?? 0);
  const amount = (value: string | number | null | undefined) => formatDisplayNumber(number(value));
  const totals = snapshot.rows.reduce<{ gross: number; advances: number; deductions: number; net: number }>((value, row) => ({
    gross: value.gross + number(row.gross), advances: value.advances + number(row.advances), deductions: value.deductions + number(row.deductions), net: value.net + number(row.net),
  }), { gross: 0, advances: 0, deductions: 0, net: 0 });
  const rows = snapshot.rows.map((row) => `<tr><td dir="ltr">${escapeHtml(String(row.employeeNumber ?? ''))}</td><td>${escapeHtml(String(row.employee ?? ''))}</td><td dir="ltr">${amount(row.gross)}</td><td dir="ltr">${amount(row.advances)}</td><td dir="ltr">${amount(row.deductions)}</td><td dir="ltr" class="net">${amount(row.net)}</td></tr>`).join('');
  const totalLabel = ar ? 'الإجمالي' : 'Total';
  const summaryCards: Array<[string, string]> = [
    [ar ? 'الموظفون' : 'Employees', String(snapshot.rows.length)],
    [label('gross', ar ? 'إجمالي الراتب' : 'Gross'), amount(totals.gross)],
    [label('advances', ar ? 'تسوية السلف' : 'Advances'), amount(totals.advances)],
    [label('deductions', ar ? 'الخصومات الإدارية' : 'Deductions'), amount(totals.deductions)],
    [label('net', ar ? 'صافي المستحق' : 'Net payable'), amount(totals.net)],
  ];
  const summary = summaryCards.map(([title, value]) => `<div class="summary-item"><span>${escapeHtml(title)}</span><b dir="ltr">${escapeHtml(value)}</b></div>`).join('');
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 portrait; margin: 13mm 12mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, "Noto Sans Arabic", sans-serif; color: #172d24; font-size: 9px; line-height: 1.4; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 10px; border-bottom: 2px solid #0b7651; }
    .brand { display: flex; align-items: center; gap: 9px; }.brand-logo,.brand-mark { width: 38px; height: 38px; object-fit: contain; }.brand-mark { display:grid; place-items:center; border-radius: 9px; background:#0b7651; color:#fff; font-size:22px; font-weight:800; }
    .company { margin: 0; color: #0b7651; font-size: 14px; font-weight: 800; }.system { margin: 2px 0 0; color:#52675e; font-size:9px; }.title { text-align: end; }.title h1 { margin:0; font-size:20px; line-height:1.2; }.title p { margin:3px 0 0; color:#52675e; }
    .meta { display:grid; grid-template-columns:repeat(3, 1fr); gap:7px; margin:10px 0; }.meta div,.summary-item { border:1px solid #d6e3dc; border-radius:6px; background:#f8fbf9; }.meta div { padding:6px 8px; }.meta span,.summary-item span { display:block; color:#52675e; font-size:8px; }.meta b { font-size:10px; }
    .summary { display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin-bottom:12px; }.summary-item { padding:7px 8px; }.summary-item b { display:block; margin-top:2px; color:#17372a; font-size:11px; }.summary-item:nth-child(5) { border-color:#8ec7af; background:#edf8f1; }.summary-item:nth-child(5) b { color:#086442; }
    table { width:100%; border-collapse:collapse; border:1px solid #cddbd3; } thead { display:table-header-group; } th { padding:7px 5px; background:#0b7651; color:#fff; font-size:8px; font-weight:700; text-align:inherit; white-space:nowrap; } td { padding:7px 5px; border-bottom:1px solid #e0e9e4; vertical-align:middle; } th:first-child,td:first-child { width:16%; } th:nth-child(2),td:nth-child(2) { width:28%; } tbody tr:nth-child(even) { background:#f8fbf9; } td:nth-child(n+3) { text-align:end; font-variant-numeric:tabular-nums; } td.net { color:#086442; font-weight:800; } tfoot th { padding:8px 5px; background:#eaf5ef; color:#17372a; border-top:2px solid #0b7651; text-align:inherit; } tfoot th:nth-child(n+2) { text-align:end; font-variant-numeric:tabular-nums; }
    .signatures { display:grid; grid-template-columns:repeat(3, 1fr); gap:30px; margin-top:20px; page-break-inside:avoid; }.signature { min-height:40px; padding-top:7px; border-top:1px solid #668277; color:#52675e; font-size:9px; }.footer { display:flex; justify-content:space-between; gap:12px; margin-top:10px; padding-top:6px; border-top:1px solid #d6e3dc; color:#52675e; font-size:8px; }
    @media print { tr,.signatures { break-inside:avoid; } }
  </style></head><body><header class="header"><div class="brand">${logo}<div><p class="company">${escapeHtml(company)}</p><p class="system">Baseer ERP</p></div></div><div class="title"><h1>${escapeHtml(snapshot.title)}</h1><p>${escapeHtml(snapshot.periodLabel)}</p></div></header><section class="meta"><div><span>${ar ? 'الفترة / رقم المسير' : 'Period / run number'}</span><b>${escapeHtml(snapshot.periodLabel)}</b></div><div><span>${ar ? 'مصدر البيانات' : 'Data source'}</span><b>${escapeHtml(snapshot.sourceLabel)}</b></div><div><span>${ar ? 'وقت الإنشاء' : 'Generated at'}</span><b dir="ltr">${escapeHtml(snapshot.generatedAtRiyadh)}</b></div></section><section class="summary">${summary}</section><table><thead><tr><th>${escapeHtml(label('employeeNumber', ar ? 'رقم الموظف' : 'Employee no.'))}</th><th>${escapeHtml(label('employee', ar ? 'الموظف' : 'Employee'))}</th><th>${escapeHtml(label('gross', ar ? 'إجمالي الراتب' : 'Gross'))}</th><th>${escapeHtml(label('advances', ar ? 'تسوية السلف' : 'Advances'))}</th><th>${escapeHtml(label('deductions', ar ? 'الخصم الإداري' : 'Administrative deduction'))}</th><th>${escapeHtml(label('net', ar ? 'صافي المستحق' : 'Net payable'))}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="2">${totalLabel}</th><th dir="ltr">${amount(totals.gross)}</th><th dir="ltr">${amount(totals.advances)}</th><th dir="ltr">${amount(totals.deductions)}</th><th dir="ltr">${amount(totals.net)}</th></tr></tfoot></table><section class="signatures"><div class="signature">${ar ? 'إعداد الموارد البشرية' : 'Prepared by HR'}</div><div class="signature">${ar ? 'المراجعة المالية' : 'Finance review'}</div><div class="signature">${ar ? 'اعتماد الإدارة' : 'Management approval'}</div></section><footer class="footer"><span>${ar ? 'مستند مُنشأ من بيانات خادمية موثقة' : 'Document generated from verified server data'}</span><span dir="ltr">${escapeHtml(snapshot.reportCode)} · ${escapeHtml(snapshot.snapshotId)}</span></footer></body></html>`;
}

function renderPayrollSignatureSlips(snapshot: ReportSnapshot): string {
  const company = snapshot.companies.map((item) => item.name).join(snapshot.locale === 'ar' ? '، ' : ', ');
  const logo = snapshot.companyLogoDataUri ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(company)}">` : '<div class="brand-mark" aria-hidden="true">B</div>';
  const amount = (value: string | number | null | undefined) => formatDisplayNumber(value ?? 0);
  const slips = (snapshot.payrollSignatureSlips ?? []).map((slip) => `<section class="slip">
    <header class="slip-header"><div class="brand">${logo}<div><strong>${escapeHtml(company)}</strong><small>Baseer ERP</small></div></div><div class="document-title"><p class="document-kind">كشف توقيع الرواتب <span>·</span> Payroll Signature Slip</p><h1>إقرار استلام راتب <small>Salary Receipt Acknowledgment</small></h1><p dir="ltr">${escapeHtml(snapshot.periodLabel)}</p></div></header>
    <main><section><h2><span>بيانات الموظف</span><small>Employee Information</small></h2><div class="identity"><div class="identity-name"><span>اسم الموظف <small>Employee name</small></span><b>${escapeHtml(slip.employeeName)}</b></div><div><span>رقم الموظف <small>Employee no.</small></span><b dir="ltr">${escapeHtml(slip.employeeNumber)}</b></div><div><span>فترة المسير <small>Payroll period</small></span><b dir="ltr">${escapeHtml(snapshot.periodLabel)}</b></div></div></section>
    <section><h2><span>تفاصيل الاستحقاق</span><small>Payroll Summary</small></h2><div class="net-card"><span>صافي المستحق <small>Net payable</small></span><strong dir="ltr">${escapeHtml(amount(slip.net))} <small>SAR</small></strong></div><table><tbody><tr><th>إجمالي الراتب <small>Gross salary</small></th><td dir="ltr">${escapeHtml(amount(slip.gross))} SAR</td></tr><tr><th>تسوية السلف <small>Advance settlement</small></th><td dir="ltr">${escapeHtml(amount(slip.advances))} SAR</td></tr><tr><th>الخصومات الإدارية <small>Administrative deductions</small></th><td dir="ltr">${escapeHtml(amount(slip.deductions))} SAR</td></tr></tbody></table></section>
    <section class="declaration"><h2><span>إقرار الاستلام</span><small>Receipt Acknowledgment</small></h2><p>أقر باستلامي بيان راتبي الموضح أعلاه، وأن صافي المستحق هو المبلغ بعد جميع التسويات والخصومات المسجلة.<span>I acknowledge receipt of the payroll statement above and confirm that the net payable reflects all recorded settlements and deductions.</span></p></section>
    <section><h2><span>التوقيعات</span><small>Signatures</small></h2><div class="signatures"><div><span>توقيع الموظف <small>Employee signature</small></span><i></i><p>${escapeHtml(slip.employeeName)} <small>الاسم / Name</small></p><p>التاريخ / Date: ____________________</p></div><div><span>اعتماد المنشأة <small>Company authorization</small></span><i></i><p>${escapeHtml(company)} <small>المنشأة / Company</small></p><p>التاريخ / Date: ____________________</p></div></div></section></main>
    <footer><span>وثيقة للاطلاع والتوقيع فقط — لا تُنشئ أو تعدّل قيداً محاسبياً.<small>Signature document only — it does not create or amend accounting entries.</small></span><span dir="ltr">${escapeHtml(snapshot.generatedAtRiyadh)} · ${escapeHtml(snapshot.snapshotId)}</span></footer>
  </section>`).join('');
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 portrait; margin: 12mm; } * { box-sizing:border-box; } body { margin:0; background:#f3f6f4; color:#172d24; font-family:Arial,"Noto Sans Arabic",sans-serif; font-size:12px; }
    .slip { min-height:273mm; margin:0 auto 10mm; background:#fff; border:1px solid #d7e3dd; border-radius:10px; overflow:hidden; break-after:page; page-break-after:always; } .slip:last-child { break-after:auto; page-break-after:auto; }
    .slip-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:16px 18px 14px; border-top:5px solid #0b7651; border-bottom:1px solid #dce7e1; } .brand { display:flex; align-items:center; gap:10px; } .brand-logo,.brand-mark { width:42px; height:42px; object-fit:contain; } .brand-mark { display:grid; place-items:center; border-radius:9px; background:#0b7651; color:#fff; font-size:22px; font-weight:800; } .brand strong { display:block; font-size:14px; } .brand small,.document-title p { display:block; margin:3px 0 0; color:#64776e; font-size:9px; } .document-title { text-align:end; } .document-kind { color:#0b7651 !important; font-size:9px !important; font-weight:800; } .document-kind span { margin:0 4px; color:#a7b8af; } h1 { margin:0; font-size:20px; line-height:1.35; } h1 small { display:block; margin-top:2px; color:#64776e; font-size:10px; font-weight:700; } main { padding:17px 18px; } section { margin-top:17px; } section:first-child { margin-top:0; } h2 { display:flex; align-items:baseline; gap:7px; margin:0 0 9px; padding-bottom:7px; border-bottom:1px solid #dce7e1; color:#17372a; font-size:12px; } h2::before { content:""; display:inline-block; width:4px; height:15px; margin-inline-end:1px; vertical-align:-3px; border-radius:99px; background:#0b7651; } h2 small { color:#708279; font-size:9px; font-weight:600; }
    .identity { display:grid; grid-template-columns:1.45fr 1fr 1fr; gap:1px; overflow:hidden; border:1px solid #dce7e1; border-radius:8px; background:#dce7e1; } .identity div { min-height:61px; padding:10px 11px; background:#fff; } .identity span { display:block; color:#466157; font-size:10px; font-weight:750; } .identity span small, th small, .net-card span small { display:block; margin-top:2px; color:#71837a; font-size:8px; font-weight:600; } .identity b { display:block; margin-top:6px; font-size:12px; } .net-card { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:9px; padding:12px 14px; border:1px solid #9fcdb5; border-radius:8px; background:#eff9f3; } .net-card span { color:#27533e; font-size:12px; font-weight:800; } .net-card strong { color:#087047; font-size:23px; } .net-card strong small { font-size:10px; } table { width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid #dce7e1; border-radius:8px; } th,td { padding:9px 11px; border-bottom:1px solid #e5ede9; text-align:inherit; } tr:last-child th,tr:last-child td { border-bottom:0; } th { color:#466157; font-weight:800; } td { text-align:end; font-weight:800; font-variant-numeric:tabular-nums; } .declaration { padding:0; } .declaration p { margin:0; padding:10px 12px; border-inline-start:3px solid #89b49e; background:#f8fbf9; color:#355548; line-height:1.75; font-size:10px; } .declaration p span { display:block; margin-top:6px; direction:ltr; text-align:start; color:#64776e; font-size:9px; } .signatures { display:grid; grid-template-columns:1fr 1fr; gap:24px; } .signatures > div { min-height:91px; padding:8px 10px; border:1px solid #dce7e1; border-radius:8px; } .signatures span { display:block; color:#17372a; font-weight:800; } .signatures span small { display:block; margin-top:2px; color:#71837a; font-size:8px; font-weight:600; } .signatures i { display:block; height:38px; border-bottom:1px solid #748b7f; } .signatures p { margin:5px 0 0; color:#526a5e; font-size:9px; } .signatures p small { margin-inline-start:5px; color:#71837a; font-size:8px; } footer { display:flex; justify-content:space-between; gap:12px; padding:10px 18px 12px; border-top:1px solid #dce7e1; color:#64776e; font-size:8px; } footer small { display:block; margin-top:3px; font-size:7px; } @media print { body { background:#fff; } .slip { margin:0; border:0; border-radius:0; } }
  </style></head><body>${slips}</body></html>`;
}
