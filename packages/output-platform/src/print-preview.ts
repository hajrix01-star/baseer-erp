import type { ReportSnapshot } from './contracts.js';
import { escapeHtml, formatDisplayNumber, formatReportCell } from './formatting.js';

/** Renders report content only. It deliberately never clones the interactive application UI. */
export function renderPrintPreviewDocument(snapshot: ReportSnapshot): string {
  if (snapshot.template === 'payroll-signature-slips') return renderPayrollSignatureSlips(snapshot);
  if (snapshot.template === 'payroll-run') return renderPayrollRun(snapshot);
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
  const ar = snapshot.locale === 'ar';
  const logo = snapshot.companyLogoDataUri ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(company)}">` : '<div class="brand-mark" aria-hidden="true">B</div>';
  const amount = (value: string | number | null | undefined) => formatDisplayNumber(value ?? 0);
  const slips = (snapshot.payrollSignatureSlips ?? []).map((slip) => `<section class="slip">
    <header class="slip-header"><div class="brand">${logo}<div><strong>${escapeHtml(company)}</strong><small>Baseer ERP</small></div></div><div class="document-title"><h1>${ar ? 'كشف استلام راتب' : 'Salary receipt'}</h1><p>${escapeHtml(snapshot.periodLabel)}</p></div></header>
    <main><section><h2>${ar ? 'بيانات الموظف' : 'Employee details'}</h2><div class="identity"><div><span>${ar ? 'الموظف' : 'Employee'}</span><b>${escapeHtml(slip.employeeName)}</b></div><div><span>${ar ? 'رقم الموظف' : 'Employee no.'}</span><b dir="ltr">${escapeHtml(slip.employeeNumber)}</b></div></div></section>
    <section><h2>${ar ? 'ملخص الاستحقاق' : 'Payment summary'}</h2><div class="net-card"><span>${ar ? 'صافي المستحق' : 'Net payable'}</span><strong dir="ltr">${escapeHtml(amount(slip.net))} <small>SAR</small></strong></div><table><tbody><tr><th>${ar ? 'إجمالي الراتب' : 'Gross salary'}</th><td dir="ltr">${escapeHtml(amount(slip.gross))} SAR</td></tr><tr><th>${ar ? 'تسوية السلف' : 'Advance settlement'}</th><td dir="ltr">${escapeHtml(amount(slip.advances))} SAR</td></tr><tr><th>${ar ? 'الخصم الإداري' : 'Administrative deduction'}</th><td dir="ltr">${escapeHtml(amount(slip.deductions))} SAR</td></tr></tbody></table></section>
    <p class="declaration">${ar ? 'أقر باستلامي تفاصيل هذا المسير وفق البيانات الموضحة أعلاه، وأن صافي المستحق هو المبلغ بعد جميع التسويات والخصومات.' : 'I acknowledge receipt of this payroll statement and confirm that the net payable is after all recorded settlements and deductions.'}</p>
    <section><h2>${ar ? 'التوقيعات' : 'Signatures'}</h2><div class="signatures"><div><span>${ar ? 'توقيع الموظف' : 'Employee signature'}</span><i></i><b>${escapeHtml(slip.employeeName)}</b><small>${ar ? 'التاريخ' : 'Date'}</small></div><div><span>${ar ? 'ختم المنشأة وتوقيع المفوض' : 'Company authorization'}</span><i></i><b>${escapeHtml(company)}</b><small>${ar ? 'التاريخ' : 'Date'}</small></div></div></section></main>
    <footer>${ar ? 'وثيقة للاطلاع والتوقيع — لا تُنشئ أو تعدّل قيداً محاسبياً.' : 'Signature document only — it does not create or amend accounting entries.'}<span dir="ltr">${escapeHtml(snapshot.generatedAtRiyadh)} · ${escapeHtml(snapshot.snapshotId)}</span></footer>
  </section>`).join('');
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>
    @page { size: A4 portrait; margin: 13mm; } * { box-sizing:border-box; } body { margin:0; background:#f3f6f4; color:#172d24; font-family:Arial,"Noto Sans Arabic",sans-serif; font-size:12px; }
    .slip { min-height:270mm; margin:0 auto 10mm; background:#fff; border:1px solid #d7e3dd; border-radius:12px; overflow:hidden; break-after:page; page-break-after:always; } .slip:last-child { break-after:auto; page-break-after:auto; }
    .slip-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:17px 19px 14px; border-top:4px solid #0b7651; border-bottom:1px solid #dce7e1; } .brand { display:flex; align-items:center; gap:10px; } .brand-logo,.brand-mark { width:44px; height:44px; object-fit:contain; } .brand-mark { display:grid; place-items:center; border-radius:9px; background:#0b7651; color:#fff; font-size:23px; font-weight:800; } .brand strong { display:block; font-size:15px; } .brand small,.document-title p { display:block; margin:3px 0 0; color:#64776e; font-size:9px; } .document-title { text-align:end; } h1 { margin:0; font-size:21px; } main { padding:17px 19px; } section { margin-top:18px; } section:first-child { margin-top:0; } h2 { margin:0 0 9px; padding-bottom:7px; border-bottom:1px solid #dce7e1; color:#17372a; font-size:12px; } h2::before { content:""; display:inline-block; width:4px; height:15px; margin-inline-end:7px; vertical-align:-3px; border-radius:99px; background:#0b7651; }
    .identity { display:grid; grid-template-columns:2fr 1fr; gap:1px; overflow:hidden; border:1px solid #dce7e1; border-radius:8px; background:#dce7e1; } .identity div { min-height:56px; padding:9px 11px; background:#fff; } .identity span { display:block; color:#64776e; font-size:9px; } .identity b { display:block; margin-top:5px; font-size:12px; } .net-card { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:9px; padding:12px 14px; border:1px solid #b8d8c8; border-radius:9px; background:#eff9f3; } .net-card span { color:#35604b; font-weight:700; } .net-card strong { color:#087047; font-size:22px; } .net-card small { font-size:10px; } table { width:100%; border-collapse:separate; border-spacing:0; overflow:hidden; border:1px solid #dce7e1; border-radius:8px; } th,td { padding:9px 11px; border-bottom:1px solid #e5ede9; text-align:inherit; } tr:last-child th,tr:last-child td { border-bottom:0; } th { color:#466157; font-weight:700; } td { text-align:end; font-weight:800; font-variant-numeric:tabular-nums; } .declaration { margin:22px 0; padding:9px 11px; border-inline-start:3px solid #a8beb2; color:#526a5e; line-height:1.8; font-size:10px; } .signatures { display:grid; grid-template-columns:1fr 1fr; gap:28px; } .signatures > div { min-height:80px; } .signatures span { display:block; font-weight:800; } .signatures i { display:block; height:42px; border-bottom:1px solid #748b7f; } .signatures b,.signatures small { display:block; margin-top:5px; font-size:9px; } .signatures small { color:#64776e; } footer { display:flex; justify-content:space-between; gap:12px; padding:10px 19px 12px; border-top:1px solid #dce7e1; color:#64776e; font-size:8px; } @media print { body { background:#fff; } .slip { margin:0; border:0; border-radius:0; } }
  </style></head><body>${slips}</body></html>`;
}
