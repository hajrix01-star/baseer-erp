import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerTextArea, BaseerTextInput } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect } from "./baseer-filter-controls";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { formatNumber, formatPercent } from "./number-format";
import { isPositiveMoneyDecimal } from "./decimal-string";
import {
  approveHrFinalSettlement, createHrFinalSettlement, listHrAdministrativeDeductions,
  getHrFinalSettlement, listHrAdvances, listHrEmployees, listHrFinalSettlements, payHrFinalSettlement,
  previewHrFinalSettlement, reverseHrFinalSettlement, reverseHrFinalSettlementPayment, verifyHrFinalSettlementReason, type HrAdministrativeDeduction,
  type HrAdvance, type HrEmployee, type HrFinalSettlement, type HrFinalSettlementReason,
  type HrFinalSettlementRecovery, type HrFinalSettlementStatus, type HrPayment,
} from "./hr-client";
import { reportTopmostDialogError } from "./use-dialog-focus-trap";
import { hasActivePermission } from "./module-access";

type Language = "ar" | "en";
type Tab = "calculator" | "register";
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP";
type Vault = { id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: PaymentMethod; paymentMethods: PaymentMethod[] };
type Allocation = { vaultId: string; paymentMethod: PaymentMethod | ""; amount: string };
type Draft = { employeeId: string; terminationDate: string; terminationReason: HrFinalSettlementReason; reasonEvidenceReference: string; reasonEvidenceNote: string };
type RecoveryRow = { id: string; recoveryType: HrFinalSettlementRecovery["recoveryType"]; reference: string; remainingAmount: string };

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = (): Draft => ({ employeeId: "", terminationDate: today(), terminationReason: "EMPLOYER_TERMINATION", reasonEvidenceReference: "", reasonEvidenceNote: "" });
const money = (value: string) => formatNumber(value);

export function HrFinalSettlementWorkspace({ language, employee }: { language: Language; employee?: HrEmployee }) {
  const ar = language === "ar";
  const canCreate = hasActivePermission("hr.final_settlements.create");
  const canRead = hasActivePermission("hr.final_settlements.read");
  const canVerify = hasActivePermission("hr.final_settlements.verify");
  const canApprove = hasActivePermission("hr.final_settlements.approve");
  const canPay = hasActivePermission("hr.final_settlements.pay");
  const canReverse = hasActivePermission("hr.final_settlements.reverse");
  const canReadAdvances = hasActivePermission("hr.advances.read");
  const canManageDeductions = hasActivePermission("hr.deductions.manage");
  const canReadFinanceConfiguration = hasActivePermission("finance.configuration.read");
  const validationCopy = useMemo(() => ar ? {
    date: "اختر تاريخاً صحيحاً.",
    employee: "اختر الموظف.",
    evidence: "أدخل مرجع دليل الإنهاء.",
    verification: "أدخل ملاحظة التحقق.",
    vault: "اختر الخزينة.",
    amount: "أدخل مبلغاً صحيحاً.",
    positiveAmount: "يجب أن يكون المبلغ أكبر من صفر.",
    allocation: "أضف توزيع سداد واحداً على الأقل.",
    cancellation: "أدخل سبب الإلغاء.",
  } : {
    date: "Choose a valid date.",
    employee: "Choose an employee.",
    evidence: "Enter the termination evidence reference.",
    verification: "Enter the verification note.",
    vault: "Choose a vault.",
    amount: "Enter a valid amount.",
    positiveAmount: "The amount must be greater than zero.",
    allocation: "Add at least one payment allocation.",
    cancellation: "Enter the cancellation reason.",
  }, [ar]);
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
  const [serverSearch, setServerSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState(employee?.id ?? "");
  const [statusFilter, setStatusFilter] = useState<"" | HrFinalSettlementStatus>("");
  const [selected, setSelected] = useState<HrFinalSettlement | null>(null);
  const [payments, setPayments] = useState<HrPayment[]>([]);
  const [nextPaymentCursor, setNextPaymentCursor] = useState<string | null>(null);
  const [paymentToReverse, setPaymentToReverse] = useState<HrPayment | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [businessDate, setBusinessDate] = useState(today());
  const [reverseReason, setReverseReason] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const showError = (value: string) => { if (!reportTopmostDialogError(value)) setMessage(value); };
  const loadRequestRef = useRef(0);
  const availableTabs = useMemo(() => [
    ...(canCreate ? [{ id: "calculator" as const, label: ar ? "مكافأة نهاية الخدمة" : "End-of-service award" }] : []),
    ...(canRead ? [{ id: "register" as const, label: ar ? "سجل المخالصات" : "Settlement register" }] : []),
  ], [ar, canCreate, canRead]);
  useEffect(() => { const timeout = window.setTimeout(() => setServerSearch(search.trim()), 250); return () => window.clearTimeout(timeout); }, [search]);

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
    REVERSED: ar ? "ملغاة" : "Cancelled",
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
  const dateSchema = useMemo(() => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, validationCopy.date), [validationCopy.date]);
  const previewForm = useBaseerForm<Draft>({
    schema: useMemo(() => z.object({
      employeeId: z.string().min(1, validationCopy.employee),
      terminationDate: dateSchema,
      terminationReason: z.enum(["EMPLOYER_TERMINATION", "RESIGNATION", "ARTICLE_80", "ARTICLE_81", "FORCE_MAJEURE", "MATERNITY", "OTHER_LEGAL_REVIEW"]),
      reasonEvidenceReference: z.string().trim().min(1, validationCopy.evidence).max(240),
      reasonEvidenceNote: z.string().max(2000),
    }), [dateSchema, validationCopy.employee, validationCopy.evidence]),
    values: draft,
  });
  const approveForm = useBaseerForm<{ businessDate: string }>({ schema: useMemo(() => z.object({ businessDate: dateSchema }), [dateSchema]), values: { businessDate } });
  const verifyForm = useBaseerForm<{ verificationNote: string }>({ schema: useMemo(() => z.object({ verificationNote: z.string().trim().min(1, validationCopy.verification).max(2000) }), [validationCopy.verification]), values: { verificationNote } });
  const paymentSchema = useMemo(() => z.object({
    businessDate: dateSchema,
    allocations: z.array(z.object({
      vaultId: z.string().min(1, validationCopy.vault),
      paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]),
      amount: baseerDecimalString(validationCopy.amount).refine(isPositiveMoneyDecimal, validationCopy.positiveAmount),
    })).min(1, validationCopy.allocation),
  }), [dateSchema, validationCopy.allocation, validationCopy.amount, validationCopy.positiveAmount, validationCopy.vault]);
  const payForm = useBaseerForm<{ businessDate: string; allocations: Allocation[] }>({ schema: paymentSchema, values: { businessDate, allocations } });
  const reverseForm = useBaseerForm<{ businessDate: string; reason: string }>({ schema: useMemo(() => z.object({ businessDate: dateSchema, reason: z.string().trim().min(1, validationCopy.cancellation) }), [dateSchema, validationCopy.cancellation]), values: { businessDate, reason: reverseReason } });

  const selectedRecoveries = (): HrFinalSettlementRecovery[] => recoveryRows.flatMap((row) => {
    const amount = recoveries[row.id] ?? "";
    return isPositiveMoneyDecimal(amount) ? [{ recoveryType: row.recoveryType, sourceId: row.id, amount }] : [];
  });
  const previewPayload = () => ({ employeeId: draft.employeeId, terminationDate: draft.terminationDate, terminationReason: draft.terminationReason, reasonEvidenceReference: draft.reasonEvidenceReference.trim(), ...(draft.reasonEvidenceNote.trim() ? { reasonEvidenceNote: draft.reasonEvidenceNote.trim() } : {}), recoveries: selectedRecoveries() });

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession();
    setSession(current);
    if (!current || !canRead) { setSettlements([]); setNextCursor(null); setLoading(false); return; }
    const requestNumber = ++loadRequestRef.current;
    if (!append) setLoading(true);
    try {
      const receipt = await listHrFinalSettlements(current, { cursor, pageSize: 25, employeeId: employeeFilter || undefined, status: statusFilter || undefined, search: serverSearch || undefined });
      if (requestNumber !== loadRequestRef.current) return;
      setSettlements((rows) => append ? [...rows, ...receipt.settlements] : receipt.settlements);
      setNextCursor(receipt.nextCursor);
    } catch (error) {
      showError(presentBaseerApiError(error, language, ar ? "تعذر تحميل سجل المخالصات." : "Final-settlement register could not be loaded."));
    } finally { if (requestNumber === loadRequestRef.current) setLoading(false); }
  }, [ar, canRead, employeeFilter, language, serverSearch, statusFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!employee) return;
    setDraft((value) => ({ ...value, employeeId: employee.id }));
    setEmployeeFilter(employee.id);
    setPreview(null);
  }, [employee]);
  useEffect(() => {
    const current = activeSession();
    if (!current || !draft.employeeId || !canCreate) { setAdvances([]); setDeductions([]); setRecoveries({}); return; }
    void Promise.all([
      canReadAdvances ? listHrAdvances(current, { employeeId: draft.employeeId, pageSize: 100 }) : Promise.resolve({ advances: [] as HrAdvance[] }),
      canManageDeductions ? listHrAdministrativeDeductions(current, { employeeId: draft.employeeId, pageSize: 100 }) : Promise.resolve({ deductions: [] as HrAdministrativeDeduction[] }),
    ]).then(([advanceReceipt, deductionReceipt]) => {
      setAdvances(advanceReceipt.advances);
      setDeductions(deductionReceipt.deductions);
      setRecoveries({});
    }).catch((error) => showError(presentBaseerApiError(error, language, ar ? "تعذر تحميل الأرصدة القابلة للاسترداد." : "Recoverable balances could not be loaded.")));
  }, [ar, canCreate, canManageDeductions, canReadAdvances, draft.employeeId, language]);

  const searchEmployees = useCallback(async (query: string, signal: AbortSignal) => {
    const current = activeSession();
    if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 }, { signal });
    return receipt.employees.filter((employee) => employee.status === "TERMINATED").map((employee) => ({ id: employee.id, label: labelEmployee(employee) }));
  }, [labelEmployee]);

  const preparePreview = async () => {
    const current = activeSession();
    if (!current || !draft.employeeId || !draft.terminationDate) return;
    setPreviewLoading(true); setMessage("");
    try { setPreview(await previewHrFinalSettlement(current, previewPayload())); }
    catch (error) { setPreview(null); showError(presentBaseerApiError(error, language, ar ? "تعذرت معاينة المخالصة." : "Final-settlement preview could not be prepared.")); }
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
    } catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر إنشاء مسودة المخالصة." : "Final-settlement draft could not be created.")); }
    finally { setBusy(false); }
  };
  const loadVaults = async () => {
    const current = activeSession();
    if (!current || !selected || !canReadFinanceConfiguration) return;
    const configuration = await api<{ vaults: Vault[] }>(current, "/finance/configuration");
    setVaults(configuration.vaults);
    const first = configuration.vaults.find((item) => item.status === "ACTIVE" && item.isPaymentDestination);
    setAllocations(first ? [{ vaultId: first.id, paymentMethod: first.paymentMethod, amount: String(Math.max(0, Number(selected.netPayableAmount) - Number(selected.paidAmount))) }] : []);
  };
  const openPayDialog = async () => {
    try { await loadVaults(); setPayOpen(true); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر تحميل الخزائن." : "Vaults could not be loaded.")); }
  };
  const approve = async () => {
    const current = activeSession(); if (!current || !selected) return;
    setBusy(true);
    try { await approveHrFinalSettlement(current, { settlementId: selected.id, businessDate, idempotencyKey: requestId() }); setApproveOpen(false); setSelected(null); await load(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر اعتماد المخالصة." : "The final settlement could not be approved.")); }
    finally { setBusy(false); }
  };
  const verifyReason = async () => {
    const current = activeSession(); if (!current || !selected || !verificationNote.trim()) return;
    setBusy(true);
    try { await verifyHrFinalSettlementReason(current, { settlementId: selected.id, verificationNote: verificationNote.trim(), idempotencyKey: requestId() }); setVerifyOpen(false); setSelected(null); await load(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر التحقق من سبب الإنهاء." : "The termination reason could not be verified.")); }
    finally { setBusy(false); }
  };
  const pay = async () => {
    const current = activeSession(); if (!current || !selected) return;
    setBusy(true);
    try { await payHrFinalSettlement(current, { settlementId: selected.id, businessDate, allocations, idempotencyKey: requestId() }); setPayOpen(false); setSelected(null); await load(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر صرف المخالصة." : "The final settlement could not be paid.")); }
    finally { setBusy(false); }
  };
  const reverse = async () => {
    const current = activeSession(); if (!current || !selected) return;
    setBusy(true);
    try { await reverseHrFinalSettlement(current, { settlementId: selected.id, businessDate, reason: reverseReason, idempotencyKey: requestId() }); setReverseOpen(false); setSelected(null); await load(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر إلغاء المخالصة." : "The final settlement could not be cancelled.")); }
    finally { setBusy(false); }
  };
  const openSettlementDetail = async (settlement: HrFinalSettlement) => {
    const current = activeSession(); if (!current) return;
    setSelected(settlement); setPayments([]); setNextPaymentCursor(null);
    try { const receipt = await getHrFinalSettlement(current, settlement.id, { pageSize: 100 }); setSelected(receipt.settlement); setPayments(receipt.payments); setNextPaymentCursor(receipt.nextPaymentCursor); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر تحميل تفاصيل المخالصة." : "Final-settlement details could not be loaded.")); }
  };
  const reversePayment = async () => {
    const current = activeSession(); if (!current || !paymentToReverse || !selected || busy || !reverseReason.trim()) return;
    setBusy(true);
    try { await reverseHrFinalSettlementPayment(current, { finalSettlementPaymentId: paymentToReverse.id, businessDate, reason: reverseReason.trim(), idempotencyKey: requestId() }); const receipt = await getHrFinalSettlement(current, selected.id, { pageSize: 100 }); setSelected(receipt.settlement); setPayments(receipt.payments); setNextPaymentCursor(receipt.nextPaymentCursor); setPaymentToReverse(null); setReverseReason(""); await load(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر إلغاء دفعة المخالصة." : "The final-settlement payment could not be cancelled.")); }
    finally { setBusy(false); }
  };
  const loadMorePayments = async () => {
    const current = activeSession(); if (!current || !selected || !nextPaymentCursor || busy) return;
    setBusy(true);
    try { const receipt = await getHrFinalSettlement(current, selected.id, { paymentCursor: nextPaymentCursor, pageSize: 100 }); setPayments((rows) => [...new Map([...rows, ...receipt.payments].map((payment) => [payment.id, payment])).values()]); setNextPaymentCursor(receipt.nextPaymentCursor); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر تحميل بقية دفعات المخالصة." : "More final-settlement payments could not be loaded.")); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!availableTabs.some((item) => item.id === tab)) setTab(availableTabs[0]?.id ?? "calculator");
  }, [availableTabs, tab]);

  const rows = settlements;
  const canOutput = selected?.status === "APPROVED" || selected?.status === "PARTIALLY_PAID" || selected?.status === "PAID";
  const reasonRequiresVerification = selected?.terminationReason === "ARTICLE_80" || selected?.terminationReason === "ARTICLE_81" || selected?.terminationReason === "FORCE_MAJEURE" || selected?.terminationReason === "MATERNITY" || selected?.terminationReason === "OTHER_LEGAL_REVIEW";
  const paymentColumns = [{ id: "number", header: ar ? "رقم الدفعة" : "Payment no.", cell: (payment: HrPayment) => payment.paymentNumber }, { id: "date", header: ar ? "التاريخ" : "Date", cell: (payment: HrPayment) => payment.businessDate }, { id: "amount", header: ar ? "المبلغ" : "Amount", cell: (payment: HrPayment) => money(payment.amount) }, { id: "status", header: ar ? "الحالة" : "Status", cell: (payment: HrPayment) => payment.status === "POSTED" ? (ar ? "مثبت" : "Posted") : (ar ? "ملغاة" : "Cancelled") }, { id: "action", header: ar ? "الإجراء" : "Action", cell: (payment: HrPayment) => hasActivePermission("hr.final_settlements.reverse") && payment.status === "POSTED" ? <BaseerButton type="button" variant="danger" onClick={() => { setBusinessDate(today()); setReverseReason(""); setPaymentToReverse(payment); }}>{ar ? "إلغاء الدفعة" : "Cancel payment"}</BaseerButton> : "—" }];

  if (!availableTabs.length) return <BaseerCard>{ar ? "لا تملك صلاحية عرض أو إعداد تسويات نهاية الخدمة." : "You do not have permission to view or prepare final settlements."}</BaseerCard>;

  return <section className="administration-workspace">
    <BaseerWorkspaceTabs ariaLabel={ar ? "تبويبات مكافأة نهاية الخدمة" : "End-of-service award tabs"} idPrefix="hr-final-settlement" activeId={tab} onChange={(value) => setTab(value as Tab)} tabs={availableTabs} />
    <BaseerBatchPanel id={`hr-final-settlement-panel-${tab}`} labelledBy={`hr-final-settlement-${tab}`}>
      {message ? <BaseerCard>{message}</BaseerCard> : null}
      {tab === "calculator" ? <>
        <form className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={previewForm.handleSubmit(() => void preparePreview())}>
          {employee ? <label>{ar ? "الموظف" : "Employee"}<BaseerTextInput readOnly value={labelEmployee(employee)} /></label> : <label>{ar ? "الموظف" : "Employee"}<BaseerCombobox required label={ar ? "الموظف" : "Employee"} value={draft.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={[]} remoteSearch={searchEmployees} scopeKey={session?.companyId ?? "signed-out"} onChange={(employeeId) => { setDraft((value) => ({ ...value, employeeId })); setPreview(null); }} />{previewForm.formState.errors.employeeId ? <small role="alert">{previewForm.formState.errors.employeeId.message}</small> : null}</label>}
          <label>{ar ? "تاريخ الإنهاء" : "Termination date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الإنهاء" : "Termination date"} value={draft.terminationDate} onChange={(terminationDate) => { setDraft((value) => ({ ...value, terminationDate })); setPreview(null); }} />{previewForm.formState.errors.terminationDate ? <small role="alert">{previewForm.formState.errors.terminationDate.message}</small> : null}</label>
          <label>{ar ? "سبب الإنهاء" : "Termination reason"}<BaseerStaticSelect label={ar ? "سبب الإنهاء" : "Termination reason"} value={draft.terminationReason} onChange={(event) => { setDraft((value) => ({ ...value, terminationReason: event.target.value as HrFinalSettlementReason })); setPreview(null); }}>{(["EMPLOYER_TERMINATION", "RESIGNATION", "ARTICLE_80", "ARTICLE_81", "FORCE_MAJEURE", "MATERNITY", "OTHER_LEGAL_REVIEW"] as const).map((reason) => <option key={reason} value={reason}>{labelReason(reason)}</option>)}</BaseerStaticSelect></label>
          <label>{ar ? "مرجع دليل الإنهاء" : "Termination evidence reference"}<BaseerTextInput required maxLength={240} aria-invalid={Boolean(previewForm.formState.errors.reasonEvidenceReference)} value={draft.reasonEvidenceReference} placeholder={ar ? "رقم خطاب أو قرار أو مرجع موثّق" : "Letter, decision, or documented reference"} onChange={(event) => { setDraft((value) => ({ ...value, reasonEvidenceReference: event.target.value })); setPreview(null); }} />{previewForm.formState.errors.reasonEvidenceReference ? <small role="alert">{previewForm.formState.errors.reasonEvidenceReference.message}</small> : null}</label>
          <label>{ar ? "ملاحظة الدليل (اختيارية)" : "Evidence note (optional)"}<BaseerTextArea compact maxLength={2000} value={draft.reasonEvidenceNote} onValueChange={(reasonEvidenceNote) => { setDraft((value) => ({ ...value, reasonEvidenceNote })); setPreview(null); }} /></label>
          <BaseerButton type="submit" disabled={previewLoading || !draft.employeeId || !draft.reasonEvidenceReference.trim()}>{previewLoading ? (ar ? "جارٍ المعاينة…" : "Previewing…") : (ar ? "معاينة خادمية" : "Server preview")}</BaseerButton>
        </form>
        <BaseerCard><p>{ar ? "الإصدار الأول: مكافأة نهاية الخدمة + استردادات مرجعية فقط. لا يشمل رصيد الإجازة أو المادة 77 أو أي مستحقات أخرى؛ الخادم وحده يحسب المكافأة والصافي." : "V1 covers the end-of-service award plus referenced recoveries only. It excludes leave balance, Article 77, and other credits; the server alone calculates the award and net amount."}</p></BaseerCard>
        {recoveryRows.length ? <BaseerDataGrid ariaLabel={ar ? "أرصدة قابلة للاسترداد" : "Recoverable balances"} caption={ar ? "السلف والخصومات المراد استردادها" : "Advances and deductions to recover"} rows={recoveryRows} rowKey={(row) => row.id} columns={[
          { id: "type", header: ar ? "النوع" : "Type", cell: (row: RecoveryRow) => row.recoveryType === "ADVANCE" ? (ar ? "سلفة" : "Advance") : (ar ? "خصم إداري" : "Administrative deduction") },
          { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: RecoveryRow) => row.reference },
          { id: "remaining", header: ar ? "المتاح" : "Available", cell: (row: RecoveryRow) => money(row.remainingAmount) },
          { id: "recovery", header: ar ? "استرداد" : "Recovery", cell: (row: RecoveryRow) => <BaseerMoneyInput value={recoveries[row.id] ?? ""} onValueChange={(amount) => { setRecoveries((values) => ({ ...values, [row.id]: amount })); setPreview(null); }} /> },
        ]} /> : null}
        {preview ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص معاينة المخالصة" : "Final-settlement preview summary"}>
          <BaseerSummaryMetric label={ar ? "أيام الخدمة" : "Service days"} value={preview.serviceDays} />
          <BaseerSummaryMetric label={ar ? "أجر نهاية الخدمة" : "EOS wage"} value={money(preview.eosWage)} />
          <BaseerSummaryMetric label={ar ? "المكافأة الكاملة" : "Full award"} value={money(preview.fullAwardAmount)} />
          <BaseerSummaryMetric label={ar ? "نسبة الاستحقاق" : "Entitlement"} value={formatPercent(Number(preview.entitlementFactor) * 100)} />
          <BaseerSummaryMetric label={ar ? "مكافأة نهاية الخدمة" : "EOS amount"} value={money(preview.eosAmount)} />
          <BaseerSummaryMetric label={ar ? "الاستردادات" : "Recoveries"} value={money(preview.recoveryAmount)} />
          <BaseerSummaryMetric label={ar ? "صافي المخالصة" : "Net settlement"} value={money(preview.netPayableAmount)} />
        </BaseerSummaryMetricGrid><BaseerCard><strong>{ar ? "قرار الحساب" : "Calculation decision"}</strong><p>{ar ? `سياسة الخادم: ${preview.calculationPolicyVersion}. لا توجد صيغة أو أجر مدخل يدوياً.` : `Server policy: ${preview.calculationPolicyVersion}. No local formula or manually entered wage is used.`}</p><BaseerButton type="button" disabled={busy} onClick={() => void create()}>{ar ? "إنشاء مسودة المخالصة" : "Create settlement draft"}</BaseerButton></BaseerCard></> : null}
      </> : null}
      {tab === "register" ? <>
        <BaseerFilterBar language={language} search={search} searchLabel={ar ? "بحث المخالصات" : "Search settlements"} searchPlaceholder={ar ? "رقم المخالصة أو الحالة" : "Number or status"} onSearchChange={setSearch} controls={<>{employee ? null : <label>{ar ? "الموظف" : "Employee"}<BaseerCombobox label={ar ? "الموظف" : "Employee"} value={employeeFilter} placeholder={ar ? "كل الموظفين" : "All employees"} options={[]} remoteSearch={searchEmployees} scopeKey={session?.companyId ?? "signed-out"} onChange={setEmployeeFilter} /></label>}<BaseerFilterSelect label={ar ? "الحالة" : "Status"} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | HrFinalSettlementStatus)}><option value="">{ar ? "كل الحالات" : "All statuses"}</option>{(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED", "CANCELLED"] as const).map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</BaseerFilterSelect></>} />
        {loading ? <BaseerCard>{ar ? "جارٍ تحميل سجل المكافآت…" : "Loading award register…"}</BaseerCard> : rows.length ? <BaseerDataGrid ariaLabel={ar ? "سجل مكافأة نهاية الخدمة" : "End-of-service award register"} caption={ar ? "سجل مكافأة نهاية الخدمة" : "End-of-service award register"} rows={rows} rowKey={(row) => row.id} columns={[
          { id: "number", header: ar ? "المخالصة" : "Settlement", cell: (row: HrFinalSettlement) => <BaseerButton type="button" variant="quiet" onClick={() => void openSettlementDetail(row)}>{row.settlementNumber}</BaseerButton> },
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
      {session && canOutput && canRead ? <BaseerOutputActions session={session} reportCode={selected.outputReportCode} language={language} filters={{ settlementId: selected.id }} printLabel={ar ? "معاينة وطباعة A4" : "Preview & print A4"} allowExport={false} /> : null}
      {canVerify && selected.status === "DRAFT" && reasonRequiresVerification && selected.reasonVerificationStatus !== "VERIFIED" ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { setVerificationNote(""); setVerifyOpen(true); }}>{ar ? "تحقق من السبب" : "Verify reason"}</BaseerButton> : null}
      {canApprove && selected.status === "DRAFT" ? <BaseerButton type="button" disabled={busy || Boolean(reasonRequiresVerification && selected.reasonVerificationStatus !== "VERIFIED")} onClick={() => { setBusinessDate(today()); setApproveOpen(true); }}>{ar ? "اعتماد" : "Approve"}</BaseerButton> : null}
      {canPay && canReadFinanceConfiguration && (selected.status === "APPROVED" || selected.status === "PARTIALLY_PAID") ? <BaseerButton type="button" disabled={busy} onClick={() => void openPayDialog()}>{ar ? "صرف" : "Pay"}</BaseerButton> : null}
      {canReverse && selected.status !== "DRAFT" && selected.status !== "REVERSED" && selected.status !== "CANCELLED" ? <BaseerButton type="button" variant="danger" disabled={busy} onClick={() => { setBusinessDate(today()); setReverseReason(""); setReverseOpen(true); }}>{ar ? "إلغاء" : "Cancel"}</BaseerButton> : null}
    </> : undefined}>{selected ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص المخالصة" : "Settlement summary"}><BaseerSummaryMetric label={ar ? "مكافأة نهاية الخدمة" : "EOS"} value={money(selected.eosAmount)} /><BaseerSummaryMetric label={ar ? "الاستردادات" : "Recoveries"} value={money(selected.recoveryAmount)} /><BaseerSummaryMetric label={ar ? "الصافي" : "Net"} value={money(selected.netPayableAmount)} /><BaseerSummaryMetric label={ar ? "المدفوع" : "Paid"} value={money(selected.paidAmount)} /></BaseerSummaryMetricGrid>{reasonRequiresVerification && selected.reasonVerificationStatus !== "VERIFIED" ? <BaseerCard>{ar ? "يتطلب هذا السبب تحققاً موثقاً قبل الاعتماد." : "This reason requires documented verification before approval."}</BaseerCard> : null}<dl className="administration-details"><div><dt>{ar ? "السبب" : "Reason"}</dt><dd>{labelReason(selected.terminationReason)}</dd></div><div><dt>{ar ? "مرجع الدليل" : "Evidence reference"}</dt><dd>{selected.reasonEvidenceReference}</dd></div><div><dt>{ar ? "تحقق السبب" : "Reason verification"}</dt><dd>{labelVerification(selected.reasonVerificationStatus)}</dd></div><div><dt>{ar ? "تاريخ الإنهاء" : "Termination date"}</dt><dd>{selected.terminationDate}</dd></div><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{labelStatus(selected.status)}</dd></div><div><dt>{ar ? "سياسة الحساب" : "Calculation policy"}</dt><dd>{selected.calculationPolicyVersion}</dd></div></dl>{payments.length ? <BaseerDataGrid ariaLabel={ar ? "دفعات المخالصة" : "Final-settlement payments"} caption={ar ? "دفعات المخالصة" : "Final-settlement payments"} rows={payments} rowKey={(payment) => payment.id} columns={paymentColumns} /> : null}{nextPaymentCursor ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void loadMorePayments()}>{ar ? "تحميل دفعات إضافية" : "Load more payments"}</BaseerButton> : null}</> : null}</BaseerDialog>

    <BaseerFormDialog open={approveOpen} title={ar ? "اعتماد المخالصة" : "Approve final settlement"} language={language} busy={busy} size="compact" formId="hr-settlement-approve" submitLabel={ar ? "اعتماد" : "Approve"} onClose={() => setApproveOpen(false)}>
      <form id="hr-settlement-approve" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={approveForm.handleSubmit(() => void approve())}><BaseerFormSection title={ar ? "تاريخ الاعتماد" : "Approval date"}><BaseerFormGrid columns="one"><label>{ar ? "تاريخ الاعتماد" : "Approval date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الاعتماد" : "Approval date"} value={businessDate} onChange={setBusinessDate} />{approveForm.formState.errors.businessDate ? <small role="alert">{approveForm.formState.errors.businessDate.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form>
    </BaseerFormDialog>
    <BaseerFormDialog open={verifyOpen} title={ar ? "تحقق من سبب الإنهاء" : "Verify termination reason"} language={language} busy={busy} size="compact" formId="hr-settlement-verify" submitLabel={ar ? "تأكيد التحقق" : "Confirm verification"} submitDisabled={!verificationNote.trim()} onClose={() => setVerifyOpen(false)}>
      <form id="hr-settlement-verify" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={verifyForm.handleSubmit(() => void verifyReason())}><BaseerFormSection title={ar ? "ملاحظة التحقق" : "Verification note"}><BaseerFormGrid columns="one"><label>{ar ? "ملاحظة التحقق" : "Verification note"}<BaseerTextArea compact required maxLength={2000} value={verificationNote} onValueChange={setVerificationNote} />{verifyForm.formState.errors.verificationNote ? <small role="alert">{verifyForm.formState.errors.verificationNote.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form>
    </BaseerFormDialog>
    <BaseerFormDialog open={payOpen} title={ar ? "صرف المخالصة" : "Pay final settlement"} language={language} busy={busy} size="standard" formId="hr-settlement-pay" submitLabel={ar ? "تسجيل الصرف" : "Record payment"} submitDisabled={!allocations.length} onClose={() => setPayOpen(false)}>
      <form id="hr-settlement-pay" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={payForm.handleSubmit(() => void pay())}>
        <BaseerFormSection title={ar ? "بيانات الصرف" : "Payment details"}><BaseerFormGrid columns="one"><BaseerDatePicker language={language} label={ar ? "تاريخ الصرف" : "Payment date"} value={businessDate} onChange={setBusinessDate} /></BaseerFormGrid></BaseerFormSection>
        {allocations.map((allocation, index) => <BaseerFormSection key={`${allocation.vaultId}-${index}`} title={ar ? `توزيع ${index + 1}` : `Allocation ${index + 1}`}><BaseerFormGrid>
          <label>{ar ? "الخزينة" : "Vault"}<BaseerCombobox required label={ar ? "الخزينة" : "Vault"} value={allocation.vaultId} placeholder={ar ? "اختر الخزينة" : "Select vault"} options={activeVaults.map((vault) => ({ id: vault.id, label: ar ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, vaultId, paymentMethod: vault?.paymentMethod ?? "" } : row)); }} /></label>
          <label>{ar ? "طريقة السداد" : "Payment method"}<BaseerCombobox searchable={false} required label={ar ? "طريقة السداد" : "Payment method"} value={allocation.paymentMethod} placeholder={ar ? "اختر الطريقة" : "Select method"} options={(activeVaults.find((vault) => vault.id === allocation.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, paymentMethod: paymentMethod as PaymentMethod } : row))} /></label>
          <label className="baseer-form-field--full">{ar ? "المبلغ" : "Amount"}<BaseerMoneyInput required value={allocation.amount} onValueChange={(amount) => setAllocations((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount } : row))} />{payForm.formState.errors.allocations?.[index]?.amount ? <small role="alert">{payForm.formState.errors.allocations[index]?.amount?.message}</small> : null}</label>
          {allocations.length > 1 ? <BaseerButton type="button" variant="quiet" onClick={() => setAllocations((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>{ar ? "إزالة هذا التوزيع" : "Remove this allocation"}</BaseerButton> : null}
        </BaseerFormGrid></BaseerFormSection>)}
        <BaseerButton type="button" variant="secondary" onClick={() => { const vault = activeVaults.find((item) => !allocations.some((allocation) => allocation.vaultId === item.id)) ?? activeVaults[0]; if (vault) setAllocations((rows) => [...rows, { vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: "" }]); }}>{ar ? "إضافة خزينة" : "Add vault"}</BaseerButton>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={reverseOpen} title={ar ? "إلغاء المخالصة" : "Cancel final settlement"} language={language} busy={busy} size="compact" formId="hr-settlement-reverse" submitLabel={ar ? "إلغاء" : "Cancel"} submitDisabled={!reverseReason.trim()} onClose={() => setReverseOpen(false)}>
      <form id="hr-settlement-reverse" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={reverseForm.handleSubmit(() => void reverse())}><BaseerFormSection title={ar ? "سبب الإلغاء" : "Cancellation reason"}><BaseerFormGrid columns="one"><label>{ar ? "تاريخ الإلغاء" : "Cancellation date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الإلغاء" : "Cancellation date"} value={businessDate} onChange={setBusinessDate} />{reverseForm.formState.errors.businessDate ? <small role="alert">{reverseForm.formState.errors.businessDate.message}</small> : null}</label><label>{ar ? "سبب الإلغاء" : "Cancellation reason"}<BaseerTextArea compact required value={reverseReason} onValueChange={setReverseReason} />{reverseForm.formState.errors.reason ? <small role="alert">{reverseForm.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form>
    </BaseerFormDialog>
    <BaseerFormDialog open={Boolean(paymentToReverse)} title={ar ? "إلغاء دفعة المخالصة" : "Cancel final-settlement payment"} language={language} busy={busy} size="compact" formId="hr-settlement-payment-reverse" submitLabel={ar ? "إلغاء" : "Cancel"} submitDisabled={!reverseReason.trim()} onClose={() => setPaymentToReverse(null)}><form id="hr-settlement-payment-reverse" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={reverseForm.handleSubmit(() => void reversePayment())}><BaseerFormSection title={paymentToReverse?.paymentNumber ?? ""}><BaseerFormGrid columns="one"><label>{ar ? "تاريخ الإلغاء" : "Cancellation date"}<BaseerDatePicker language={language} label={ar ? "تاريخ الإلغاء" : "Cancellation date"} max={today()} value={businessDate} onChange={setBusinessDate} />{reverseForm.formState.errors.businessDate ? <small role="alert">{reverseForm.formState.errors.businessDate.message}</small> : null}</label><label>{ar ? "سبب الإلغاء" : "Cancellation reason"}<BaseerTextArea compact required value={reverseReason} onValueChange={setReverseReason} />{reverseForm.formState.errors.reason ? <small role="alert">{reverseForm.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
  </section>;
}
