import './nurix-excel-import-panel.css';

import { useEffect, useMemo, useState } from 'react';

import { BaseerApiError } from './baseer-api-error';
import { BaseerButton } from './baseer-button';
import { BaseerCard } from './baseer-card';
import { BaseerFileInput } from './baseer-form-fields';
import { BaseerStatusBadge } from './baseer-status-badge';
import { BaseerNotice } from './baseer-workspace';
import { listAvailableCompanies, type ActiveSession, type AvailableCompany } from './daily-sales-client';
import { executeNurixExcelMasterData, loadNurixExcelImportTemplate, loadNurixHistoricalPayrollEvidence, startNurixExcelImportPreflight, type NurixExcelImportPreflight, type NurixExcelImportTemplate, type NurixExcelMasterDataExecution, type NurixHistoricalPayrollEvidence } from './nurix-migration-client';
import { formatCount, formatDateTime } from './number-format';

type Language = 'ar' | 'en';

const copy = {
  ar: {
    title: 'حزمة Excel الموحدة من نوركس',
    description: 'ارفع حزمة نوركس الموحدة للفحص التجريبي في الذاكرة. لا ينشئ هذا الفحص أي فاتورة أو قيد أو عملية مالية.',
    company: 'الشركة المستهدفة',
    template: 'عرض بنية قالب نوركس',
    templateHelp: 'راجع بنية الأوراق والأعمدة المطلوبة. لا تعدّل صف العناوين أو معرّفات نوركس عند تجهيز الحزمة.',
    file: 'ملف الحزمة',
    chooseFile: 'اختيار ملف Excel',
    fileHelp: 'ملف واحد بصيغة .xlsx حتى 5 ميجابايت. يُفحص في الذاكرة فقط؛ وتُرفض الماكرو والصيغ والروابط الخارجية.',
    sourceCompany: 'معرّف الشركة المصدر في نوركس',
    sourceCompanyHelp: 'اكتب معرّف الشركة كما يظهر في حزمة نوركس وورقة Manifest؛ يتحقق منه قارئ Excel أثناء الفحص.',
    preflight: 'تشغيل تجربة Excel',
    preflightHelp: 'يفحص الخادم الأوراق والصفوف ويقارن البيانات الأساسية مع الشركة المختارة. لا يكتب أي بيانات تشغيلية أو مالية.',
    noFile: 'اختر ملف Excel أولاً.',
    noRun: 'اكتب معرّف الشركة المصدر في نوركس أولاً.',
    invalidSourceCompany: 'معرّف نوركس لا يقبل مسافات أو علامات ترقيم؛ انسخ المعرّف كما هو من ورقة Manifest.',
    invalidFile: 'اختر ملفاً واحداً بصيغة .xlsx.',
    tooLarge: 'حجم الملف أكبر من حد تجربة Excel الآمنة (5 ميجابايت).',
    unready: 'خدمة فحص حزمة Excel لم تُفعّل على الخادم بعد. يمكنك تنزيل القالب وتجهيز الملف الآن.',
    failed: 'تعذر تنفيذ فحص الحزمة. تحقق من صلاحية المالك واتصال الخادم.',
    running: 'جارٍ قراءة الحزمة وفحصها تجريبياً…',
    selected: 'تم اختيار الملف',
    stageTitle: 'مسار الحزمة',
    stages: ['اختيار الشركة', 'تعريف الملف', 'فحص البنية', 'تجربة بلا كتابة', 'مراجعة النتيجة'],
    history: 'آخر فحص تمهيدي في هذه الصفحة',
    noHistory: 'لم يجر فحص تمهيدي بعد.',
    parsedRows: 'الصفوف المقروءة', accepted: 'مقبول', rejected: 'مرفوض', rowIssues: 'مشكلات الصفوف',
    blockers: 'عوائق',
    warnings: 'تنبيهات',
    currentStage: 'الحالة',
    safetyTitle: 'حدود الحماية',
    safety: 'لا يوجد في هذه الواجهة زر استيراد فعلي أو اعتماد مالي. بعد اجتياز الفحص قد تحفظ الحزمة مشفّرة للاستئناف فقط، وتُراجع بصمتها قبل استخدامها.',
    masterData: 'مطابقة البيانات الأساسية', exactMatches: 'مطابق قائم', createCandidates: 'مرشح إنشاء', reviewRequired: 'يتطلب مراجعة',
    refresh: 'تحديث الشركات',
    masterExecute: 'إنشاء الحسابات والتصنيفات والموظفين', masterExecuteHelp: 'ينفذ موجات آمنة من البيانات المرجعية فقط. لا ينشئ موردين أو خزائن أو فواتير أو قيود.', masterDone: 'اكتملت موجات البيانات المرجعية.', masterReceipt: 'نتيجة إنشاء البيانات المرجعية', created: 'أُنشئ', reused: 'أُعيد استخدامه', review: 'مراجعة', waves: 'الموجات', noFinancialWrites: 'لا توجد كتابة مالية', accounts: 'الحسابات', categories: 'التصنيفات', employees: 'الموظفون', historicalPayroll: 'مسيرات الرواتب التاريخية من نوركس', historicalPayrollHelp: 'دليل محفوظ للمراجعة فقط؛ لا يمكن اعتماده أو دفعه أو تحويله إلى قيد.', payrollPeriod: 'فترة الراتب', approvedAt: 'اعتمد في نوركس', payrollLines: 'بنود', payrollNet: 'الصافي', paymentEvidence: 'دليل الدفع', noPaymentEvidence: 'لا يوجد دليل دفع', amountOnly: 'مبلغ فقط — بلا تاريخ',
  },
  en: {
    title: 'Noorix unified Excel package',
    description: 'Upload the unified Noorix package for an in-memory dry-run. This never creates invoices, journals, or financial activity.',
    company: 'Target company', template: 'View Noorix template structure', templateHelp: 'Review the required sheets and columns. Do not edit header rows or Noorix identifiers when preparing the package.',
    file: 'Package file', chooseFile: 'Choose Excel file', fileHelp: 'One .xlsx file up to 5 MiB. Macros, formulas, and external links are rejected.', sourceCompany: 'Noorix source company ID', sourceCompanyHelp: 'Enter the company ID shown in both the Noorix package and its Manifest sheet; the Excel parser verifies it during the dry-run.', preflight: 'Run Excel dry-run', preflightHelp: 'The server validates the package and compares master data with the selected company. It writes no operational or financial data.',
    noFile: 'Choose an Excel file first.', noRun: 'Enter the Noorix source company ID before validating the package.', invalidSourceCompany: 'A Noorix ID cannot contain spaces or punctuation; copy it exactly from the Manifest sheet.', invalidFile: 'Choose one .xlsx file.', tooLarge: 'The file exceeds the safe Excel dry-run limit of 5 MiB.', unready: 'The Excel package validation service is not enabled on this server yet. You can view the template structure and prepare the package now.', failed: 'The Excel dry-run could not be completed. Check owner access and server connectivity.', running: 'Reading and validating the package in dry-run…', selected: 'File selected', stageTitle: 'Package path', stages: ['Choose company', 'Send file bytes', 'Validate structure', 'Dry-run without writes', 'Review result'], history: 'Latest preflight on this page', noHistory: 'No package preflight has run yet.', parsedRows: 'Parsed rows', accepted: 'Accepted', rejected: 'Rejected', rowIssues: 'Row issues', blockers: 'Blockers', warnings: 'Warnings', currentStage: 'Status', safetyTitle: 'Safety boundary', safety: 'This interface has no actual-import or financial-approval action. A verified package may be retained encrypted only to resume review, and its checksum is rechecked before use.', refresh: 'Refresh companies', masterData: 'Master-data matching', exactMatches: 'Existing exact matches', createCandidates: 'Create candidates', reviewRequired: 'Needs review', masterExecute: 'Create accounts, categories and employees', masterExecuteHelp: 'Runs safe master-data waves only. It never creates suppliers, vaults, invoices, or journals.', masterDone: 'Master-data waves completed.', masterReceipt: 'Master-data creation result', created: 'Created', reused: 'Reused', review: 'Review', waves: 'Waves', noFinancialWrites: 'No financial writes', accounts: 'Accounts', categories: 'Categories', employees: 'Employees', historicalPayroll: 'Historical Noorix payroll', historicalPayrollHelp: 'Read-only evidence; it cannot be approved, paid, or turned into a journal.', payrollPeriod: 'Payroll period', approvedAt: 'Approved in Noorix', payrollLines: 'Lines', payrollNet: 'Net', paymentEvidence: 'Payment evidence', noPaymentEvidence: 'No payment evidence', amountOnly: 'Amount only — no date',
  },
} as const;

export function NurixExcelImportPanel({ language, session }: { language: Language; session: ActiveSession }) {
  const text = copy[language];
  const [companies, setCompanies] = useState<AvailableCompany[]>([]);
  const [targetCompanyId, setTargetCompanyId] = useState(session.companyId);
  const [sourceCompanyId, setSourceCompanyId] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileSha256, setFileSha256] = useState<string | null>(null);
  const [template, setTemplate] = useState<NurixExcelImportTemplate | null>(null);
  const [preflight, setPreflight] = useState<NurixExcelImportPreflight | null>(null);
  const [masterExecution, setMasterExecution] = useState<NurixExcelMasterDataExecution | null>(null);
  const [historicalPayroll, setHistoricalPayroll] = useState<NurixHistoricalPayrollEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [serviceReady, setServiceReady] = useState(true);

  const activeStep = useMemo(() => preflight ? 4 : selectedFile ? 1 : 0, [preflight, selectedFile]);
  const targetCompany = companies.find((company) => company.id === targetCompanyId);

  const load = async (companyId = targetCompanyId) => {
    setLoading(true);
    try {
      const [availableCompanies, evidence] = await Promise.all([listAvailableCompanies(session), loadNurixHistoricalPayrollEvidence(session, companyId)]);
      setCompanies(availableCompanies); setHistoricalPayroll(evidence);
    } catch (error) {
      setMessage(text.failed);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(session.companyId); }, []);

  const chooseFile = (file: File | null) => {
    setMessage(null);
    if (!file) { setSelectedFile(null); setFileSha256(null); return; }
    if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) { setSelectedFile(null); setFileSha256(null); setMessage(text.invalidFile); return; }
    if (file.size > 5 * 1024 * 1024) { setSelectedFile(null); setFileSha256(null); setMessage(text.tooLarge); return; }
    setSelectedFile(file); setPreflight(null);
    void file.arrayBuffer().then(async (bytes) => setFileSha256(hex(await crypto.subtle.digest('SHA-256', bytes)))).catch(() => setFileSha256(null));
  };

  const showTemplate = async () => {
    setBusy(true); setMessage(null);
    try {
      setTemplate(await loadNurixExcelImportTemplate(session)); setServiceReady(true);
    } catch { setServiceReady(false); setMessage(text.unready); }
    finally { setBusy(false); }
  };

  const runPreflight = async () => {
    if (!selectedFile) { setMessage(text.noFile); return; }
    if (!sourceCompanyId.trim()) { setMessage(text.noRun); return; }
    if (!/^[A-Za-z0-9_-]{8,120}$/.test(sourceCompanyId.trim())) { setMessage(text.invalidSourceCompany); return; }
    setBusy(true); setMessage(text.running);
    try {
      const contentsBase64 = await fileToBase64(selectedFile);
      const receipt = await startNurixExcelImportPreflight(session, { targetCompanyId, sourceCompanyId: sourceCompanyId.trim(), templateVersion: 'nurix-excel-package/v3', workbook: { fileName: selectedFile.name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...(fileSha256 ? { sha256: fileSha256 } : {}), byteSize: selectedFile.size, exportedAt: new Date().toISOString(), contentsBase64 } });
      setPreflight(receipt); setMessage(null); setServiceReady(true);
    } catch (error) {
      if (error instanceof BaseerApiError && error.status === 404) { setServiceReady(false); setMessage(text.unready); }
      else setMessage(error instanceof BaseerApiError ? error.message : text.failed);
    } finally { setBusy(false); }
  };
  const runMasterData = async () => {
    if (!preflight?.stagingPackageId) return;
    setBusy(true); setMessage(null);
    try { const receipt = await executeNurixExcelMasterData(session, preflight.stagingPackageId); setMasterExecution(receipt); setMessage(receipt.completed ? text.masterDone : text.failed); }
    catch (error) { setMessage(error instanceof BaseerApiError ? error.message : text.failed); }
    finally { setBusy(false); }
  };

  return <section className="nurix-excel-import" aria-labelledby="nurix-excel-import-title">
    <header className="nurix-excel-import__header"><div><h3 id="nurix-excel-import-title">{text.title}</h3><p>{text.description}</p></div><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void showTemplate()}>{text.template}</BaseerButton></header>
    <BaseerNotice tone="warning" title={text.safetyTitle}>{text.safety}</BaseerNotice>
    {!serviceReady ? <BaseerNotice tone="info">{text.unready}</BaseerNotice> : null}
    <ol className="nurix-excel-import__stages" aria-label={text.stageTitle}>{text.stages.map((stage, index) => <li key={stage} className={index < activeStep ? 'is-complete' : index === activeStep ? 'is-current' : ''}><span>{index < activeStep ? '✓' : index + 1}</span><strong>{stage}</strong></li>)}</ol>
    <BaseerCard className="nurix-excel-import__form">
      <label><span>{text.company}</span><select value={targetCompanyId} disabled={busy || loading} onChange={(event) => { const next = event.target.value; setTargetCompanyId(next); setSelectedFile(null); setMessage(null); void load(next); }}><option value={session.companyId}>{companies.find((company) => company.id === session.companyId)?.nameAr ?? session.companyId}</option>{companies.filter((company) => company.id !== session.companyId).map((company) => <option key={company.id} value={company.id}>{company.nameAr}</option>)}</select></label>
      <label><span>{text.sourceCompany}</span><input value={sourceCompanyId} disabled={busy} dir="ltr" onChange={(event) => { setSourceCompanyId(event.target.value); setPreflight(null); }} /><small>{text.sourceCompanyHelp}</small></label>
      <label><span>{text.file}</span><BaseerFileInput accept="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" disabled={busy} triggerLabel={text.chooseFile} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} /><small>{text.fileHelp}</small></label>
      <div className="nurix-excel-import__selected-file">{selectedFile ? <><BaseerStatusBadge tone="success">{text.selected}</BaseerStatusBadge><span dir="ltr">{selectedFile.name}</span><small>{formatCount(selectedFile.size, language)} B{fileSha256 ? ` · SHA-256 ${fileSha256.slice(0, 12)}…` : ''}</small></> : <small>{text.templateHelp}</small>}</div>
      <div className="nurix-excel-import__actions"><div><strong>{text.preflight}</strong><small>{text.preflightHelp}</small></div><BaseerButton type="button" variant="primary" disabled={busy || !selectedFile || !sourceCompanyId.trim()} onClick={() => void runPreflight()}>{busy ? text.running : text.preflight}</BaseerButton></div>
    </BaseerCard>
    {template ? <BaseerCard padding="compact" className="nurix-excel-import__template"><strong dir="ltr">{template.templateVersion}</strong><div>{template.sheets.map((sheet) => <div key={sheet.name}><strong dir="ltr">{sheet.name}</strong><small dir="ltr">{sheet.requiredColumns.join(' · ')}</small></div>)}</div></BaseerCard> : null}
    {message ? <BaseerNotice tone={message === text.running ? 'info' : 'warning'}>{message}</BaseerNotice> : null}
    {historicalPayroll?.runs.length ? <HistoricalPayrollEvidenceCard receipt={historicalPayroll} language={language} /> : null}
    <section className="nurix-excel-import__history"><header><h4>{text.history}{targetCompany ? ` · ${targetCompany.nameAr}` : ''}</h4><BaseerButton type="button" variant="quiet" disabled={loading || busy} onClick={() => void load()}>{text.refresh}</BaseerButton></header>{loading ? <BaseerCard padding="compact">…</BaseerCard> : preflight ? <><PreflightCard receipt={preflight} language={language} />{preflight.status === 'PARSED_DRY_RUN' && preflight.stagingPackageId ? <><BaseerCard padding="compact"><div className="nurix-excel-import__actions"><div><strong>{text.masterExecute}</strong><small>{text.masterExecuteHelp}</small></div><BaseerButton type="button" variant="primary" disabled={busy || masterExecution?.completed} onClick={() => void runMasterData()}>{text.masterExecute}</BaseerButton></div></BaseerCard>{masterExecution ? <MasterExecutionReceiptCard receipt={masterExecution} language={language} /> : null}</> : null}</> : <BaseerCard padding="compact"><p>{text.noHistory}</p></BaseerCard>}</section>
  </section>;
}

function PreflightCard({ receipt, language }: { receipt: NurixExcelImportPreflight; language: Language }) {
  const text = copy[language];
  const blockers = receipt.checks.filter((check) => !check.passed).length;
  const totals = (counts: typeof receipt.masterDataReadiness.exactMatches) => Object.values(counts).reduce((sum, value) => sum + value, 0);
  return <BaseerCard padding="compact" className="nurix-excel-import__package"><div className="nurix-excel-import__package-title"><div><strong>{text.currentStage}</strong><small dir="ltr">{receipt.mode} · {receipt.templateVersion}</small></div><BaseerStatusBadge tone={receipt.status === 'PARSED_DRY_RUN' ? 'success' : receipt.status === 'REJECTED' ? 'danger' : 'warning'}>{receipt.status}</BaseerStatusBadge></div><dl><div><dt>{text.parsedRows}</dt><dd>{formatCount(receipt.parsedRows, language)}</dd></div><div><dt>{text.accepted}</dt><dd>{formatCount(receipt.acceptedRows, language)}</dd></div><div><dt>{text.rejected}</dt><dd>{formatCount(receipt.rejectedRows, language)}</dd></div><div><dt>{text.blockers}</dt><dd>{formatCount(blockers, language)}</dd></div><div><dt>Financial writes</dt><dd>{formatCount(receipt.financialWrites, language)}</dd></div></dl>{receipt.masterDataReadiness.availability === 'READ_ONLY_ANALYZED' ? <section className="nurix-excel-import__master"><h5>{text.masterData}</h5><dl><div><dt>{text.exactMatches}</dt><dd>{formatCount(totals(receipt.masterDataReadiness.exactMatches), language)}</dd></div><div><dt>{text.createCandidates}</dt><dd>{formatCount(totals(receipt.masterDataReadiness.createCandidates), language)}</dd></div><div><dt>{text.reviewRequired}</dt><dd>{formatCount(totals(receipt.masterDataReadiness.reviewRequired), language)}</dd></div></dl></section> : null}<ul className="nurix-excel-import__checks">{receipt.checks.map((check) => <li key={check.code}><BaseerStatusBadge tone={check.passed ? 'success' : 'danger'}>{check.passed ? '✓' : '!'}</BaseerStatusBadge><span>{check.messageAr}</span></li>)}</ul>{receipt.rowIssues.length ? <section className="nurix-excel-import__issues"><h5>{text.rowIssues}</h5><ul>{receipt.rowIssues.map((issue) => <li key={`${issue.sheet}:${issue.rowNumber}:${issue.code}`}><strong dir="ltr">{issue.sheet} · {issue.rowNumber}</strong><span dir="ltr">{issue.code}</span></li>)}</ul></section> : null}</BaseerCard>;
}

function MasterExecutionReceiptCard({ receipt, language }: { receipt: NurixExcelMasterDataExecution; language: Language }) {
  const text = copy[language];
  const entities: Array<keyof NurixExcelMasterDataExecution['created']> = ['accounts', 'categories', 'employees'];
  return <BaseerCard padding="compact" className="nurix-excel-import__master-receipt"><div className="nurix-excel-import__package-title"><div><strong>{text.masterReceipt}</strong><small>{text.noFinancialWrites}</small></div><BaseerStatusBadge tone={receipt.completed ? 'success' : 'warning'}>{receipt.status}</BaseerStatusBadge></div><dl>{entities.map((entity) => <div key={entity}><dt>{text[entity]}</dt><dd>{text.created}: {formatCount(receipt.created[entity], language)} · {text.reused}: {formatCount(receipt.reused[entity], language)} · {text.review}: {formatCount(receipt.reviewRequired[entity], language)}</dd></div>)}</dl><small>{text.waves}: {formatCount(receipt.waves, language)}</small></BaseerCard>;
}

function HistoricalPayrollEvidenceCard({ receipt, language }: { receipt: NurixHistoricalPayrollEvidence; language: Language }) {
  const text = copy[language];
  return <section className="nurix-excel-import__history" aria-label={text.historicalPayroll}><header><div><h4>{text.historicalPayroll}</h4><small>{text.historicalPayrollHelp}</small></div><BaseerStatusBadge tone="info">EVIDENCE_ONLY</BaseerStatusBadge></header><div className="nurix-excel-import__master-receipt">{receipt.runs.map((run) => <BaseerCard key={run.sourceRunNumber} padding="compact" className="nurix-excel-import__package"><div className="nurix-excel-import__package-title"><div><strong dir="ltr">{run.sourceRunNumber}</strong><small>{text.payrollPeriod}: {formatDateTime(run.payrollMonth, language, 'Asia/Riyadh')}</small></div><BaseerStatusBadge tone="neutral">{text.payrollLines}: {formatCount(run.lineCount, language)}</BaseerStatusBadge></div><dl><div><dt>{text.payrollNet}</dt><dd>{run.netAmount}</dd></div><div><dt>{text.approvedAt}</dt><dd>{formatDateTime(run.sourceAccruedAt, language, 'Asia/Riyadh')}</dd></div><div><dt>{text.paymentEvidence}</dt><dd>{run.paymentEvidenceKind === 'AMOUNT_ONLY' ? `${text.amountOnly} · ${run.paymentEvidenceAmount ?? ''}` : text.noPaymentEvidence}</dd></div></dl></BaseerCard>)}</div></section>;
}

function hex(buffer: ArrayBuffer) { return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function fileToBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read Excel package.')); reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? ''); reader.readAsDataURL(file); }); }
