import type { ReportSnapshot } from './contracts.js';
import { escapeHtml, formatReportCell } from './formatting.js';

/** Renders report content only. It deliberately never clones the interactive application UI. */
export function renderPrintPreviewDocument(snapshot: ReportSnapshot): string {
  if (snapshot.template === 'payroll-signature-slips') return renderPayrollSignatureSlips(snapshot);
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

function renderPayrollSignatureSlips(snapshot: ReportSnapshot): string {
  const company = snapshot.companies.map((item) => item.name).join(snapshot.locale === 'ar' ? '، ' : ', ');
  const ar = snapshot.locale === 'ar';
  const logo = snapshot.companyLogoDataUri ? `<img class="brand-logo" src="${escapeHtml(snapshot.companyLogoDataUri)}" alt="${escapeHtml(company)}">` : '<div class="brand-mark" aria-hidden="true">B</div>';
  const slips = (snapshot.payrollSignatureSlips ?? []).map((slip) => `<section class="slip"><header><div class="brand">${logo}<div><strong>${escapeHtml(company)}</strong><small>Baseer ERP</small></div></div><div><h1>${ar ? 'كشف استلام راتب' : 'Salary receipt'}</h1><p>${escapeHtml(snapshot.periodLabel)}</p></div></header><div class="identity"><div><span>${ar ? 'الموظف' : 'Employee'}</span><b>${escapeHtml(slip.employeeName)}</b></div><div><span>${ar ? 'رقم الموظف' : 'Employee no.'}</span><b>${escapeHtml(slip.employeeNumber)}</b></div></div><table><tbody><tr><th>${ar ? 'إجمالي الراتب' : 'Gross salary'}</th><td>${escapeHtml(String(slip.gross))}</td></tr><tr><th>${ar ? 'تسوية السلف' : 'Advance settlement'}</th><td>${escapeHtml(String(slip.advances))}</td></tr><tr><th>${ar ? 'الخصم الإداري' : 'Administrative deduction'}</th><td>${escapeHtml(String(slip.deductions))}</td></tr><tr class="net"><th>${ar ? 'صافي المستحق' : 'Net payable'}</th><td>${escapeHtml(String(slip.net))}</td></tr></tbody></table><p class="declaration">${ar ? 'أقر باستلامي تفاصيل هذا المسير وفق البيانات الموضحة أعلاه.' : 'I acknowledge receipt of this payroll statement as shown above.'}</p><div class="signatures"><div><span>${ar ? 'توقيع الموظف' : 'Employee signature'}</span></div><div><span>${ar ? 'اعتماد المنشأة' : 'Company authorization'}</span></div></div><footer>${escapeHtml(snapshot.generatedAtRiyadh)} · ${escapeHtml(snapshot.snapshotId)}</footer></section>`).join('');
  return `<!doctype html><html lang="${snapshot.locale}" dir="${snapshot.direction}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>@page { size: A4 portrait; margin: 16mm; }*{box-sizing:border-box}body{margin:0;font-family:Arial,"Noto Sans Arabic",sans-serif;color:#152b22;font-size:12px}.slip{min-height:255mm;border:1px solid #d9e4de;border-radius:12px;padding:16px;break-after:page}.slip:last-child{break-after:auto}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0b7651;padding-bottom:12px;gap:12px}.brand{display:flex;gap:10px;align-items:center}.brand-logo,.brand-mark{width:42px;height:42px;object-fit:contain}.brand-mark{display:grid;place-items:center;background:#0b7651;color:#fff;border-radius:9px;font-size:24px;font-weight:800}.brand small,.slip header p{display:block;margin:3px 0 0;color:#63736c}h1{margin:0;font-size:21px}.identity{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}.identity div{padding:10px;border:1px solid #d9e4de;border-radius:8px}.identity span{display:block;color:#63736c;font-size:10px;margin-bottom:4px}table{width:100%;border-collapse:collapse}th,td{padding:11px;border-bottom:1px solid #d9e4de;text-align:inherit}.net th,.net td{font-size:15px;color:#0b7651;font-weight:800}.declaration{margin:28px 0 42px;line-height:1.8}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:42px}.signatures div{border-top:1px solid #152b22;padding-top:8px;min-height:42px}.signatures span,footer{color:#63736c;font-size:10px}footer{margin-top:30px;border-top:1px solid #d9e4de;padding-top:8px}@media print{.slip{break-inside:avoid}}</style></head><body>${slips}</body></html>`;
}
