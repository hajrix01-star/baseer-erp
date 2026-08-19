import { useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerSearchSelect } from "./baseer-search-select";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { DataTable } from "./data-table";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import {
  approveHrFinalSettlement, createHrFinalSettlement, listHrAdministrativeDeductions,
  listHrAdvances, listHrEmployees, listHrFinalSettlements, payHrFinalSettlement,
  previewHrFinalSettlement, reverseHrFinalSettlement, verifyHrFinalSettlementReason, type HrAdministrativeDeduction,
  type HrAdvance, type HrEmployee, type HrFinalSettlement, type HrFinalSettlementReason,
  type HrFinalSettlementRecovery, type HrFinalSettlementStatus,
} from "./hr-client";

type Language = "ar" | "en";
type Tab = "calculator" | "register";
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP";
type Vault = { id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: PaymentMethod; paymentMethods: PaymentMethod[] };
type Allocation = { vaultId: string; paymentMethod: PaymentMethod | ""; amount: string };
type Draft = { employeeId: string; terminationDate: string; terminationReason: HrFinalSettlementReason; reasonEvidenceReference: string; reasonEvidenceNote: string };
type RecoveryRow = { id: string; recoveryType: HrFinalSettlementRecovery["recoveryType"]; reference: string; remainingAmount: string };

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ employeeId: "", terminationDate: today(), terminationReason: "EMPLOYER_TERMINATION", reasonEvidenceReference: "", reasonEvidenceNote: "" });
const money = (value: string) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HrFinalSettlementWorkspace({ language, employee }: { language: Language; employee?: HrEmployee }) {
  const ar = language === "ar";
  const [tab, setTab] = useState<Tab>("calculator");
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft(), employeeId: employee?.id ?? "" }));
  const [advances, setAdvances] = useState<HrAdvance[]>([]);
  const [deductions, setDeductions] = useState<HrAdministrativeDeduction[]>([]);
  const [recoveries, setRecoveries] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewHrFinalSettlement>> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [settlements, setSettlements] = useState<HrFinalSettlement[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState(employee?.id ?? "");
  const [statusFilter, setStatusFilter] = useState<"" | HrFinalSettlementStatus>("");
  const [selected, setSelected] = useState<HrFinalSettlement | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [businessDate, setBusinessDate] = useState(today());
  const [reverseReason, setReverseReason] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);

  const labelEmployee = useCallback((employee: HrEmployee) => `${employee.employeeNumber} · ${ar ? employee.nameAr : employee.nameEn ?? employee.nameAr}`, [ar]);
  const labelReason = (value: HrFinalSettlementReason) => ({
    EMPLOYER_TERMINATION: ar ? "إنهاء من صاحب العمل" : "Employer termination",
    RESIGNATION: ar ? "استقالة" : "Resignation",
    ARTICLE_80: ar ? "المادة 80" : "Article 80",
    ARTICLE_81: ar ? "المادة 81" : "Article 81",
    FORCE_MAJEURE: ar ? "قوة قاهرة" : "Force majeure",
    MATERNITY: ar ? "أمومة" : "Maternity",
    OTHER_LEGAL_REVIEW: ar ? "حالة قانونية أخرى للمراجعة" : "Other legal case for review",
  })[value];
  const labelStatus = (value: HrFinalSettlementStatus) => ({
    DRAFT: ar ? "مسودة" : "Draft",
    APPROVED: ar ? "معتمدة" : "Approved",
    PARTIALLY_PAID: ar ? "مدفوعة جزئياً" : "Partially paid",
    PAID: ar ? "مدفوعة" : "Paid",
    REVERSED: ar ? "معكوسة" : "Reversed",
    CANCELLED: ar ? "ملغاة" : "Cancelled",
  })[value];
  const labelVerification = (value: HrFinalSettlement["reasonVerificationStatus"]) => ({
    PENDING: ar ? "بانتظار التحقق" : "Pending verification",
    VERIFIED: ar ? "تم التحقق" : "Verified",
    REJECTED: ar ? "مرفوض" : "Rejected",
  })[value];

  const recoveryRows = useMemo<RecoveryRow[]>(() => [
    ...advances.filter((item) => item.status === "ISSUED" || item.status === "PARTIALLY_SETTLED").map((item) => ({ id: item.id, recoveryType: "ADVANCE" as const, reference: item.advanceNumber, remainingAmount: item.remainingAmount })),
    ...deductions.filter((item) => item.status === "OPEN" || item.status === "PARTIALLY_APPLIED" || item.status === "DEFERRED").map((item) => ({ id: item.id, recoveryType: "ADMINISTRATIVE_DEDUCTION" as const, reference: item.deductionNumber, remainingAmount: item.remainingAmount })),
  ], [advances, deductions]);
  const activeVaults = useMemo(() => vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination), [vaults]);

  const selectedRecoveries = (): HrFinalSettlementRecovery[] => recoveryRows.flatMap((row) => {
    const amount = recoveries[row.id] ?? "";
    return Number(amount) > 0 ? [{ recoveryType: row.recoveryType, sourceId: row.id, amount }] : [];
  });
  const previewPayload = () => ({ employeeId: draft.employeeId, terminationDate: draft.terminationDate, terminationReason: draft.terminationReason, reasonEvidenceReference: draft.reasonEvidenceReference.trim(), ...(draft.reasonEvidenceNote.trim() ? { reasonEvidenceNote: draft.reasonEvidenceNote.trim() } : {}), recoveries: selectedRecoveries() });

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession();
    setSession(current);
    if (!current) { setLoading(false); return; }
    if (!append) setLoading(true);
    try {
      const receipt = await listHrFinalSettlements(current, { cursor, pageSize: 25, employeeId: employeeFilter || undefined, status: statusFilter || undefined });
      setSettlements((rows) => append ? [...rows, ...receipt.settlements] : receipt.settlements);
      setNextCursor(receipt.nextCursor);
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, ar ? "تعذر تحميل سجل المخالصات." : "Final-settlement register could not be loaded."));
    } finally { setLoading(false); }
  }, [ar, employeeFilter, language, statusFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!employee) return;
    setDraft((value) => ({ ...value, employeeId: employee.id }));
    setEmployeeFilter(employee.id);
    setPreview(null);
  }, [employee]);
  useEffect(() => {
    const current = activeSession();
    if (!current || !draft.employeeId) { setAdvances([]); setDeductions([]); setRecoveries({}); return; }
    void Promise.all([
      listHrAdvances(current, { employeeId: draft.employeeId, pageSize: 100 }),
      listHrAdministrativeDeductions(current, { employeeId: draft.employeeId, pageSize: 100 }),
    ]).then(([advanceReceipt, deductionReceipt]) => {
      setAdvances(advanceReceipt.advances);
      setDeductions(deductionReceipt.deductions);
      setRecoveries({});
    }).catch((error) => setMessage(presentBaseerApiError(error, language, ar ? "تعذر تحميل الأرصدة القابلة للاسترداد." : "Recoverable balances could not be loaded.")));
  }, [ar, draft.employeeId, language]);

  const searchEmployees = useCallback(async (query: string) => {
    const current = activeSession();
    if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 });
    return receipt.employees.filter((employee) => employee.status === "TERMINATED").map((employee) => ({ id: employee.id, label: labelEmployee(employee) }));
  }, [labelEmployee]);

  const preparePreview = async () => {
    const current = activeSession();
    if (!current || !draft.employeeId || !draft.terminationDate) return;
    setPreviewLoading(true); setMessage("");
    try { setPreview(await previewHrFinalSettlement(current, previewPayload())); }
    catch (error) { setPreview(null); setMessage(presentBaseerApiError(error, language, ar ? "تعذرت معاينة المخالصة." : "Final-settlement preview could not be prepared.")); }
    finally { setPreviewLoading(false); }
  };
  const create = async () => {
    const current = activeSession();
    if (!current || !preview || busy) return;
    setBusy(true);
    try {
      await createHrFinalSettlement(current, { ...previewPayload(), idempotencyKey: requestId() });
      setDraft({ ...emptyDraft(), employeeId: employee?.id ?? "" }); setPreview(null); setRecoveries({}); setTab("register");
      await load();
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر إنشاء مسودة المخالصة." : "Final-settlement draft could not be created.")); }
    finally { setBusy(false); }
  };
  const loadVaults = async () => {
    const current = activeSession();
    if (!current || !selected) return;
    const configuration = await api<{ vaults: Vault[] }>(current, "/finance/configuration");
    setVaults(configuration.vaults);
    const first = configuration.vaults.find((item) => item.status === "ACTIVE" && item.isPaymentDestination);
    setAllocations(first ? [{ vaultId: first.id, paymentMethod: first.paymentMethod, amount: String(Math.max(0, Number(selected.netPayableAmount) - Number(selected.paidAmount))) }] : []);
  };
  const openPayDialog = async () => {
    try { await loadVaults(); setPayOpen(true); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر تحميل الخزائن." : "Vaults could not be loaded.")); }
  };
  const approve = async () => {
    const current = activeSession(); if (!current || !selected) return;
    setBusy(true);
    try { await approveHrFinalSettlement(current, { settlementId: selected.id, businessDate, idempotencyKey: requestId() }); setApproveOpen(false); setSelected(null); await load(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر اعتماد المخالصة." : "The final settlement could not be approved.")); }
    finally { setBusy(false); }
  };
  const verifyReason = async () => {
    const current = activeSession(); if (!current || !selected || !verificationNote.trim()) return;
    setBusy(true);
    try { await verifyHrFinalSettlementReason(current, { settlementId: selected.id, verificationNote: verificationNote.trim(), idempotencyKey: requestId() }); setVerifyOpen(false); setSelected(null); await load(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر التحقق من سبب الإنهاء." : "The termination reason could not be verified.")); }
    finally { setBusy(false); }
  };
  const pay = async () => {
    const current = activeSession(); if (!current || !selected) return;
    setBusy(true);
    try { await payHrFinalSettlement(current, { settlementId: selected.id, businessDate, allocations, idempotencyKey: requestId() }); setPayOpen(false); setSelected(null); await load(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر صرف المخالصة." : "The final settlement could not be paid.")); }
    finally { setBusy(false); }
  };
  const reverse = async () => {
    const current = activeSession(); if (!current || !selected) return;
    setBusy(true);
    try { await reverseHrFinalSettlement(current, { settlementId: selected.id, businessDate, reason: reverseReason, idempotencyKey: requestId() }); setReverseOpen(false); setSelected(null); await load(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر عكس المخالصة." : "The final settlement could not be reversed.")); }
    finally { setBusy(false); }
  };

  const rows = settlements.filter((item) => !search.trim() || [item.settlementNumber, item.terminationDate, item.status].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const canOutput = selected?.status === "APPROVED" || selected?.status === "PARTIALLY_PAID" || selected?.status === "PAID";
  const reasonRequiresVerification = selected?.terminationReason === "ARTICLE_80" || selected?.terminationReason === "ARTICLE_81" || selected?.terminationReason === "FORCE_MAJEURE" || selected?.terminationReason === "MATERNITY" || selected?.terminationReason === "OTHER_LEGAL_REVIEW";

  return <section className="administration-workspace">
    <BaseerWorkspaceTabs ariaLabel={ar ? "تبويبات مكافأة نهاية الخدمة" : "End-of-service award tabs"} idPrefix="hr-final-settlement" activeId={tab} onChange={(value) => setTab(value as Tab)} tabs={[{ id: "calculator", label: ar ? "مكافأة نهاية الخدمة" : "End-of-service award" }, { id: "register", label: ar ? "سجل المخالصات" : "Settlement register" }]} />
    <BaseerBatchPanel id={`hr-final-settlement-panel-${tab}`} labelledBy={`hr-final-settlement-${tab}`}>
      {message ? <BaseerCard>{message}</BaseerCard> : null}
      {tab === "calculator" ? <>
        <form className="administration-form" onSubmit={(event) => { event.preventDefault(); void preparePreview(); }}>
          {employee ? <label>{ar ? "الموظف" : "Employee"}<input readOnly value={labelEmployee(employee)} /></label> : <label>{ar ? "الموظف" : "Employee"}<BaseerSearchSelect required label={ar ? "الموظف" : "Employee"} value={draft.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={[]} remoteSearch={searchEmployees} onChange={(employeeId) => { setDraft((value) => ({ ...value, employeeId })); setPreview(null); }} /></label>}
          <BaseerDatePicker language={language} label={ar ? "تاريخ الإنهاء" : "Termination date"} value={draft.terminationDate} onChange={(terminationDate) => { setDraft((value) => ({ ...value, terminationDate })); setPreview(null); }} />
          <label>{ar ? "سبب الإنهاء" : "Termination reason"}<select value={draft.terminationReason} onChange={(event) => { setDraft((value) => ({ ...value, terminationReason: event.target.value as HrFinalSettlementReason })); setPreview(null); }}>{(["EMPLOYER_TERMINATION", "RESIGNATION", "ARTICLE_80", "ARTICLE_81", "FORCE_MAJEURE", "MATERNITY", "OTHER_LEGAL_REVIEW"] as const).map((reason) => <option key={reason} value={reason}>{labelReason(reason)}</option>)}</select></label>
          <label>{ar ? "مرجع دليل الإنهاء" : "Termination evidence reference"}<input required maxLength={240} value={draft.reasonEvidenceReference} placeholder={ar ? "رقم خطاب أو قرار أو مرجع موثّق" : "Letter, decision, or documented reference"} onChange={(event) => { setDraft((value) => ({ ...value, reasonEvidenceReference: event.target.value })); setPreview(null); }} /></label>
          <label>{ar ? "ملاحظة الدليل (اختيارية)" : "Evidence note (optional)"}<textarea maxLength={2000} value={draft.reasonEvidenceNote} onChange={(event) => { setDraft((value) => ({ ...value, reasonEvidenceNote: event.target.value })); setPreview(null); }} /></label>
          <BaseerButton type="submit" disabled={previewLoading || !draft.employeeId || !draft.reasonEvidenceReference.trim()}>{previewLoading ? (ar ? "جارٍ المعاينة…" : "Previewing…") : (ar ? "معاينة خادمية" : "Server preview")}</BaseerButton>
        </form>
        <BaseerCard><p>{ar ? "الإصدار الأول: مكافأة نهاية الخدمة + استردادات مرجعية فقط. لا يشمل رصيد الإجازة أو المادة 77 أو أي مستحقات أخرى؛ الخادم وحده يحسب المكافأة والصافي." : "V1 covers the end-of-service award plus referenced recoveries only. It excludes leave balance, Article 77, and other credits; the server alone calculates the award and net amount."}</p></BaseerCard>
        {recoveryRows.length ? <DataTable ariaLabel={ar ? "أرصدة قابلة للاسترداد" : "Recoverable balances"} caption={ar ? "السلف والخصومات المراد استردادها" : "Advances and deductions to recover"} rows={recoveryRows} rowKey={(row) => row.id} columns={[
          { id: "type", header: ar ? "النوع" : "Type", cell: (row: RecoveryRow) => row.recoveryType === "ADVANCE" ? (ar ? "سلفة" : "Advance") : (ar ? "خصم إداري" : "Administrative deduction") },
          { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: RecoveryRow) => row.reference },
          { id: "remaining", header: ar ? "المتاح" : "Available", cell: (row: RecoveryRow) => money(row.remainingAmount) },
          { id: "recovery", header: ar ? "استرداد" : "Recovery", cell: (row: RecoveryRow) => <input inputMode="decimal" value={recoveries[row.id] ?? ""} onChange={(event) => { setRecoveries((values) => ({ ...values, [row.id]: event.target.value })); setPreview(null); }} /> },
        ]} /> : null}
        {preview ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص معاينة المخالصة" : "Final-settlement preview summary"}>
          <BaseerSummaryMetric label={ar ? "أيام الخدمة" : "Service days"} value={preview.serviceDays} />
          <BaseerSummaryMetric label={ar ? "أجر نهاية الخدمة" : "EOS wage"} value={money(preview.eosWage)} />
          <BaseerSummaryMetric label={ar ? "المكافأة الكاملة" : "Full award"} value={money(preview.fullAwardAmount)} />
          <BaseerSummaryMetric label={ar ? "نسبة الاستحقاق" : "Entitlement"} value={`${(Number(preview.entitlementFactor) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`} />
          <BaseerSummaryMetric label={ar ? "مكافأة نهاية الخدمة" : "EOS amount"} value={money(preview.eosAmount)} />
          <BaseerSummaryMetric label={ar ? "الاستردادات" : "Recoveries"} value={money(preview.recoveryAmount)} />
          <BaseerSummaryMetric label={ar ? "صافي المخالصة" : "Net settlement"} value={money(preview.netPayableAmount)} />
        </BaseerSummaryMetricGrid><BaseerCard><strong>{ar ? "قرار الحساب" : "Calculation decision"}</strong><p>{ar ? `سياسة الخادم: ${preview.calculationPolicyVersion}. لا توجد صيغة أو أجر مدخل يدوياً.` : `Server policy: ${preview.calculationPolicyVersion}. No local formula or manually entered wage is used.`}</p><BaseerButton type="button" disabled={busy} onClick={() => void create()}>{ar ? "إنشاء مسودة المخالصة" : "Create settlement draft"}</BaseerButton></BaseerCard></> : null}
      </> : null}
      {tab === "register" ? <>
        <BaseerFilterBar language={language} search={search} searchLabel={ar ? "بحث المخالصات" : "Search settlements"} searchPlaceholder={ar ? "رقم المخالصة أو الحالة" : "Number or status"} onSearchChange={setSearch} controls={<>{employee ? null : <label>{ar ? "الموظف" : "Employee"}<BaseerSearchSelect label={ar ? "الموظف" : "Employee"} value={employeeFilter} placeholder={ar ? "كل الموظفين" : "All employees"} options={[]} remoteSearch={searchEmployees} onChange={setEmployeeFilter} /></label>}<label>{ar ? "الحالة" : "Status"}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | HrFinalSettlementStatus)}><option value="">{ar ? "كل الحالات" : "All statuses"}</option>{(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED", "CANCELLED"] as const).map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select></label></>} />
        {loading ? <BaseerCard>{ar ? "جارٍ تحميل سجل المكافآت…" : "Loading award register…"}</BaseerCard> : rows.length ? <DataTable ariaLabel={ar ? "سجل مكافأة نهاية الخدمة" : "End-of-service award register"} caption={ar ? "سجل مكافأة نهاية الخدمة" : "End-of-service award register"} rows={rows} rowKey={(row) => row.id} columns={[
          { id: "number", header: ar ? "المخالصة" : "Settlement", cell: (row: HrFinalSettlement) => <BaseerButton type="button" variant="quiet" onClick={() => setSelected(row)}>{row.settlementNumber}</BaseerButton> },
          { id: "date", header: ar ? "تاريخ الإنهاء" : "Termination", cell: (row: HrFinalSettlement) => row.terminationDate },
          { id: "reason", header: ar ? "السبب" : "Reason", cell: (row: HrFinalSettlement) => labelReason(row.terminationReason) },
          { id: "net", header: ar ? "الصافي" : "Net", cell: (row: HrFinalSettlement) => money(row.netPayableAmount) },
          { id: "paid", header: ar ? "المدفوع" : "Paid", cell: (row: HrFinalSettlement) => money(row.paidAmount) },
          { id: "verification", header: ar ? "تحقق السبب" : "Reason verification", cell: (row: HrFinalSettlement) => labelVerification(row.reasonVerificationStatus) },
          { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrFinalSettlement) => labelStatus(row.status) },
        ]} /> : <BaseerCard>{ar ? "لا توجد مخالصات مطابقة." : "No matching final settlements."}</BaseerCard>}
        {nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
      </> : null}
    </BaseerBatchPanel>

    <BaseerDialog open={Boolean(selected)} title={selected?.settlementNumber ?? ""} language={language} busy={busy} onClose={() => setSelected(null)} footer={selected ? <>
      {session && canOutput ? <BaseerOutputActions session={session} reportCode={selected.outputReportCode} language={language} filters={{ settlementId: selected.id }} printLabel={ar ? "معاينة وطباعة A4" : "Preview & print A4"} allowExport={false} /> : null}
      {selected.status === "DRAFT" && reasonRequiresVerification && selected.reasonVerificationStatus !== "VERIFIED" ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { setVerificationNote(""); setVerifyOpen(true); }}>{ar ? "تحقق من السبب" : "Verify reason"}</BaseerButton> : null}
      {selected.status === "DRAFT" ? <BaseerButton type="button" disabled={busy || Boolean(reasonRequiresVerification && selected.reasonVerificationStatus !== "VERIFIED")} onClick={() => { setBusinessDate(today()); setApproveOpen(true); }}>{ar ? "اعتماد" : "Approve"}</BaseerButton> : null}
      {selected.status === "APPROVED" || selected.status === "PARTIALLY_PAID" ? <BaseerButton type="button" disabled={busy} onClick={() => void openPayDialog()}>{ar ? "صرف" : "Pay"}</BaseerButton> : null}
      {selected.status !== "DRAFT" && selected.status !== "REVERSED" && selected.status !== "CANCELLED" ? <BaseerButton type="button" variant="danger" disabled={busy} onClick={() => { setBusinessDate(today()); setReverseReason(""); setReverseOpen(true); }}>{ar ? "عكس" : "Reverse"}</BaseerButton> : null}
    </> : undefined}>{selected ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص المخالصة" : "Settlement summary"}><BaseerSummaryMetric label={ar ? "مكافأة نهاية الخدمة" : "EOS"} value={money(selected.eosAmount)} /><BaseerSummaryMetric label={ar ? "الاستردادات" : "Recoveries"} value={money(selected.recoveryAmount)} /><BaseerSummaryMetric label={ar ? "الصافي" : "Net"} value={money(selected.netPayableAmount)} /><BaseerSummaryMetric label={ar ? "المدفوع" : "Paid"} value={money(selected.paidAmount)} /></BaseerSummaryMetricGrid>{reasonRequiresVerification && selected.reasonVerificationStatus !== "VERIFIED" ? <BaseerCard>{ar ? "يتطلب هذا السبب تحققاً موثقاً قبل الاعتماد." : "This reason requires documented verification before approval."}</BaseerCard> : null}<dl className="administration-details"><div><dt>{ar ? "السبب" : "Reason"}</dt><dd>{labelReason(selected.terminationReason)}</dd></div><div><dt>{ar ? "مرجع الدليل" : "Evidence reference"}</dt><dd>{selected.reasonEvidenceReference}</dd></div><div><dt>{ar ? "تحقق السبب" : "Reason verification"}</dt><dd>{labelVerification(selected.reasonVerificationStatus)}</dd></div><div><dt>{ar ? "تاريخ الإنهاء" : "Termination date"}</dt><dd>{selected.terminationDate}</dd></div><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{labelStatus(selected.status)}</dd></div><div><dt>{ar ? "سياسة الحساب" : "Calculation policy"}</dt><dd>{selected.calculationPolicyVersion}</dd></div></dl></> : null}</BaseerDialog>

    <BaseerDialog open={approveOpen} title={ar ? "اعتماد المخالصة" : "Approve final settlement"} language={language} busy={busy} onClose={() => setApproveOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setApproveOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="button" disabled={busy} onClick={() => void approve()}>{ar ? "اعتماد" : "Approve"}</BaseerButton></>}><BaseerDatePicker language={language} label={ar ? "تاريخ الاعتماد" : "Approval date"} value={businessDate} onChange={setBusinessDate} /></BaseerDialog>
    <BaseerDialog open={verifyOpen} title={ar ? "تحقق من سبب الإنهاء" : "Verify termination reason"} language={language} busy={busy} onClose={() => setVerifyOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setVerifyOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="button" disabled={busy || !verificationNote.trim()} onClick={() => void verifyReason()}>{ar ? "تأكيد التحقق" : "Confirm verification"}</BaseerButton></>}><label>{ar ? "ملاحظة التحقق" : "Verification note"}<textarea required maxLength={2000} value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} /></label></BaseerDialog>
    <BaseerDialog open={payOpen} title={ar ? "صرف المخالصة" : "Pay final settlement"} language={language} busy={busy} onClose={() => setPayOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setPayOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="button" disabled={busy || !allocations.length} onClick={() => void pay()}>{ar ? "تسجيل الصرف" : "Record payment"}</BaseerButton></>}><BaseerDatePicker language={language} label={ar ? "تاريخ الصرف" : "Payment date"} value={businessDate} onChange={setBusinessDate} />{allocations.map((allocation, index) => <fieldset key={`${allocation.vaultId}-${index}`}><legend>{ar ? "توزيع خزينة" : "Vault allocation"}</legend><BaseerSearchSelect required label={ar ? "الخزينة" : "Vault"} value={allocation.vaultId} placeholder={ar ? "اختر الخزينة" : "Select vault"} options={activeVaults.map((vault) => ({ id: vault.id, label: ar ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, vaultId, paymentMethod: vault?.paymentMethod ?? "" } : row)); }} /><label>{ar ? "طريقة السداد" : "Payment method"}<select value={allocation.paymentMethod} onChange={(event) => setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, paymentMethod: event.target.value as PaymentMethod } : row))}>{(activeVaults.find((vault) => vault.id === allocation.vaultId)?.paymentMethods ?? []).map((method) => <option key={method} value={method}>{method}</option>)}</select></label><label>{ar ? "المبلغ" : "Amount"}<input required inputMode="decimal" value={allocation.amount} onChange={(event) => setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} /></label>{allocations.length > 1 ? <BaseerButton type="button" variant="quiet" onClick={() => setAllocations((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>×</BaseerButton> : null}</fieldset>)}<BaseerButton type="button" variant="quiet" onClick={() => { const vault = activeVaults.find((item) => !allocations.some((allocation) => allocation.vaultId === item.id)) ?? activeVaults[0]; if (vault) setAllocations((rows) => [...rows, { vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: "" }]); }}>+</BaseerButton></BaseerDialog>
    <BaseerDialog open={reverseOpen} title={ar ? "عكس المخالصة" : "Reverse final settlement"} language={language} busy={busy} onClose={() => setReverseOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setReverseOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="button" variant="danger" disabled={busy || !reverseReason.trim()} onClick={() => void reverse()}>{ar ? "عكس" : "Reverse"}</BaseerButton></>}><BaseerDatePicker language={language} label={ar ? "تاريخ العكس" : "Reversal date"} value={businessDate} onChange={setBusinessDate} /><label>{ar ? "السبب" : "Reason"}<textarea value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} /></label></BaseerDialog>
  </section>;
}
