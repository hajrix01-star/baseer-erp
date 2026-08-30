import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFilterSelect } from "./baseer-filter-controls";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerTextArea, BaseerTextInput } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerMoney } from "./baseer-money";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { BaseerEmptyState, BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { hrEnumLabel, hrText } from "./hr-copy";
import { HrJobTitleSelect } from "./hr-job-titles";
import { HrEmployeeDirectoryGrid } from "./hr-employee-directory-grid";
import { reportTopmostDialogError } from "./use-dialog-focus-trap";
import { hasActivePermission } from "./module-access";
import { consumeHrRouteStage } from "./hr-route-stage";
import { pageRouteHash } from "./page-registry";
import "./hr-employee-edit-dialog.css";
import { cancelHrEmployeeAdministrativeDeduction, createHrEmployeeAdministrativeDeduction, deferHrEmployeeAdministrativeDeduction, deferHrEmployeeAdvance, getHrAdministrativeDeduction, getHrAdvance, getHrEmployee, issueHrEmployeeAdvance, listHrAdministrativeDeductions, listHrAdvances, listHrEmployees, reverseHrEmployeeAdvanceIssue, settleHrEmployeeAdvanceDirectly, updateHrEmployee, type HrAdministrativeDeduction, type HrAdministrativeDeductionDetail, type HrAdvance, type HrAdvanceDetail, type HrDetail, type HrEmployee, type HrEmployeeStatus } from "./hr-client";

type Language = "ar" | "en";
type EmployeeForm = { employeeNumber: string; nameAr: string; nameEn: string; jobTitle: string; phone: string; email: string; iqamaNumber: string; workSchedule: string; hireDate: string; status: HrEmployeeStatus; statusEffectiveAt: string; statusReason: string; notes: string };
type AdvanceAllocation = { vaultId: string; amount: string; paymentMethod: "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP" | "" };
type AdvanceForm = { employeeId: string; businessDate: string; amount: string; notes: string; vaultId: string; paymentMethod: AdvanceAllocation["paymentMethod"] };
type SettlementForm = { advanceId: string; businessDate: string; amount: string; deferRemainingUntil: string; notes: string; allocations: AdvanceAllocation[] };
type DeferralForm = { advanceId: string; businessDate: string; deferredUntil: string; reason: string };
type DeductionForm = { employeeId: string; businessDate: string; amount: string; description: string; plannedPayrollDate: string };
type DeductionDeferralForm = { deductionId: string; businessDate: string; deferredUntil: string; reason: string };
type DeductionCancellationForm = { deductionId: string; businessDate: string; reason: string };
type AdvanceReversalForm = { advanceId: string; businessDate: string; reason: string };
type FinanceConfiguration = { suppliers: Array<{ id: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "ARCHIVED" }>; categories: Array<{ id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; status: "ACTIVE" | "ARCHIVED"; isPosting: boolean }>; vaults: Array<{ id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: AdvanceAllocation["paymentMethod"]; paymentMethods: Exclude<AdvanceAllocation["paymentMethod"], "">[] }> };

const today = () => new Date().toISOString().slice(0, 10);
const emptyEmployee = (): EmployeeForm => ({ employeeNumber: "", nameAr: "", nameEn: "", jobTitle: "", phone: "", email: "", iqamaNumber: "", workSchedule: "", hireDate: today(), status: "ACTIVE", statusEffectiveAt: "", statusReason: "", notes: "" });
const emptyAdvance = (employeeId = "", vaultId = "", paymentMethod: AdvanceAllocation["paymentMethod"] = ""): AdvanceForm => ({ employeeId, businessDate: today(), amount: "", notes: "", vaultId, paymentMethod });
const futureDate = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const emptySettlement = (advanceId = "", amount = "", vaultId = "", paymentMethod: AdvanceAllocation["paymentMethod"] = ""): SettlementForm => ({ advanceId, businessDate: today(), amount, deferRemainingUntil: "", notes: "", allocations: [{ vaultId, amount, paymentMethod }] });

function EmployeeViewIcon({ view }: { view: "cards" | "table" }) {
  return view === "cards" ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.25" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.25" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.25" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.25" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3.25" y="4" width="17.5" height="16" rx="1.6" />
      <path d="M3.25 9h17.5M9.1 9v11M3.25 14.5h17.5" />
    </svg>
  );
}
const emptyDeferral = (advanceId = ""): DeferralForm => ({ advanceId, businessDate: today(), deferredUntil: futureDate(30), reason: "" });
const emptyDeduction = (): DeductionForm => ({ employeeId: "", businessDate: today(), amount: "", description: "", plannedPayrollDate: "" });
const emptyDeductionDeferral = (deductionId = ""): DeductionDeferralForm => ({ deductionId, businessDate: today(), deferredUntil: futureDate(30), reason: "" });
const emptyDeductionCancellation = (deductionId = ""): DeductionCancellationForm => ({ deductionId, businessDate: today(), reason: "" });
const HrEmployeeProfileDialog = lazy(() => import("./hr-employee-profile-dialog").then((module) => ({ default: module.HrEmployeeProfileDialog })));
const HrEmployeeProfilePage = lazy(() => import("./hr-employee-profile-dialog").then((module) => ({ default: module.HrEmployeeProfilePage })));
const HrCompensationAgreementDialog = lazy(() => import("./hr-compensation-agreement-dialog").then((module) => ({ default: module.HrCompensationAgreementDialog })));
const HrEmployeeOnboardingDialog = lazy(() => import("./hr-employee-onboarding-dialog").then((module) => ({ default: module.HrEmployeeOnboardingDialog })));
const DailySalesSignIn = lazy(() => import("./daily-sales-sign-in").then((module) => ({ default: module.DailySalesSignIn })));

export function HrWorkspaceCore({ language, section, stage }: { language: Language; section: number; stage?: string | null }) {
  const text = hrText(language);
  const isAdvance = section === 4;
  const employeeProfileId = section === 1 && stage?.startsWith("employee-") ? stage.slice("employee-".length) : null;
  const canManageEmployees = hasActivePermission("hr.employees.write");
  const canIssueAdvance = hasActivePermission("hr.advances.issue");
  const canSettleAdvance = hasActivePermission("hr.advances.settle");
  const canManageDeductions = hasActivePermission("hr.deductions.manage");
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [advances, setAdvances] = useState<HrAdvance[]>([]);
  const [deductions, setDeductions] = useState<HrAdministrativeDeduction[]>([]);
  const [overview, setOverview] = useState({ activeEmployees: 0, employeesOnLeave: 0, openAdvances: 0, openAdministrativeDeductions: 0 });
  const [nextEmployeeCursor, setNextEmployeeCursor] = useState<string | null>(null);
  const [nextAdvanceCursor, setNextAdvanceCursor] = useState<string | null>(null);
  const [nextDeductionCursor, setNextDeductionCursor] = useState<string | null>(null);
  const [advanceLoadError, setAdvanceLoadError] = useState<string | null>(null);
  const [deductionLoadError, setDeductionLoadError] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<FinanceConfiguration | null>(null);
  const [search, setSearch] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState<HrEmployeeStatus | "ALL">("ACTIVE");
  const [employeeView, setEmployeeView] = useState<"cards" | "table">("cards");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const showSuccess = useCallback((text: string) => setMessage({ tone: "success", text }), []);
  const showError = useCallback((text: string) => { if (!reportTopmostDialogError(text)) setMessage({ tone: "danger", text }); }, []);
  const [detail, setDetail] = useState<HrDetail | null>(null);
  const [compensationTarget, setCompensationTarget] = useState<{ employee: HrEmployee; profile: HrDetail["compensation"] } | null>(null);
  const [advanceDetail, setAdvanceDetail] = useState<HrAdvanceDetail | null>(null);
  const [deductionDetail, setDeductionDetail] = useState<HrAdministrativeDeductionDetail | null>(null);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [additionalEmployeeInfoOpen, setAdditionalEmployeeInfoOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [deferralOpen, setDeferralOpen] = useState(false);
  const [deductionOpen, setDeductionOpen] = useState(false);
  const [deductionDeferralOpen, setDeductionDeferralOpen] = useState(false);
  const [deductionCancellationOpen, setDeductionCancellationOpen] = useState(false);
  const [advanceReversalOpen, setAdvanceReversalOpen] = useState(false);
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployee());
  const [advanceForm, setAdvanceForm] = useState<AdvanceForm>(emptyAdvance());
  const [settlementForm, setSettlementForm] = useState<SettlementForm>(emptySettlement());
  const [deferralForm, setDeferralForm] = useState<DeferralForm>(emptyDeferral());
  const [deductionForm, setDeductionForm] = useState<DeductionForm>(emptyDeduction());
  const [deductionDeferralForm, setDeductionDeferralForm] = useState<DeductionDeferralForm>(emptyDeductionDeferral());
  const [deductionCancellationForm, setDeductionCancellationForm] = useState<DeductionCancellationForm>(emptyDeductionCancellation());
  const [advanceReversalForm, setAdvanceReversalForm] = useState<AdvanceReversalForm>({ advanceId: "", businessDate: today(), reason: "" });
  const validation = useMemo(() => {
    const required = language === "ar" ? "هذا الحقل مطلوب." : "This field is required.";
    const invalidDate = language === "ar" ? "اختر تاريخاً صحيحاً." : "Choose a valid date.";
    const invalidAmount = language === "ar" ? "أدخل مبلغاً صحيحاً أكبر من صفر." : "Enter a valid amount greater than zero.";
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, invalidDate);
    const optionalDate = z.string().refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), invalidDate);
    const amount = baseerDecimalString(invalidAmount, 4, 14).refine((value) => !/^0+(?:\.0+)?$/.test(value), invalidAmount);
    const allocation = z.object({ vaultId: z.string().min(1, required), amount, paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]) });
    const reason = z.string().trim().min(1, required);
    return {
      employee: z.object({ employeeNumber: z.string(), nameAr: reason, nameEn: z.string(), jobTitle: z.string(), phone: z.string(), email: z.string().refine((value) => !value.trim() || z.email().safeParse(value.trim()).success, language === "ar" ? "أدخل بريداً صحيحاً." : "Enter a valid email."), iqamaNumber: z.string(), workSchedule: z.string(), hireDate: date, status: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED", "ARCHIVED"]), statusEffectiveAt: optionalDate, statusReason: z.string(), notes: z.string() }).superRefine((value, context) => { if ((value.status === "TERMINATED" || value.status === "ARCHIVED") && !value.statusEffectiveAt) context.addIssue({ code: "custom", path: ["statusEffectiveAt"], message: invalidDate }); if ((value.status === "TERMINATED" || value.status === "ARCHIVED") && !value.statusReason.trim()) context.addIssue({ code: "custom", path: ["statusReason"], message: required }); }),
      advance: z.object({ employeeId: z.string().min(1, required), businessDate: date, amount, notes: z.string(), vaultId: z.string().min(1, required), paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]) }),
      settlement: z.object({ advanceId: z.string().min(1, required), businessDate: date, amount, deferRemainingUntil: optionalDate, notes: z.string(), allocations: z.array(allocation).min(1, required) }),
      deferral: z.object({ advanceId: z.string().min(1, required), businessDate: date, deferredUntil: date, reason }),
      deduction: z.object({ employeeId: z.string().min(1, required), businessDate: date, amount, description: reason, plannedPayrollDate: optionalDate }),
      deductionDeferral: z.object({ deductionId: z.string().min(1, required), businessDate: date, deferredUntil: date, reason }),
      deductionCancellation: z.object({ deductionId: z.string().min(1, required), businessDate: date, reason }),
      advanceReversal: z.object({ advanceId: z.string().min(1, required), businessDate: date, reason }),
    };
  }, [language]);
  const employeeState = useBaseerForm<EmployeeForm>({ schema: validation.employee, values: employeeForm });
  const advanceState = useBaseerForm<AdvanceForm>({ schema: validation.advance, values: advanceForm });
  const settlementState = useBaseerForm<SettlementForm>({ schema: validation.settlement, values: settlementForm });
  const deferralState = useBaseerForm<DeferralForm>({ schema: validation.deferral, values: deferralForm });
  const deductionState = useBaseerForm<DeductionForm>({ schema: validation.deduction, values: deductionForm });
  const deductionDeferralState = useBaseerForm<DeductionDeferralForm>({ schema: validation.deductionDeferral, values: deductionDeferralForm });
  const deductionCancellationState = useBaseerForm<DeductionCancellationForm>({ schema: validation.deductionCancellation, values: deductionCancellationForm });
  const advanceReversalState = useBaseerForm<AdvanceReversalForm>({ schema: validation.advanceReversal, values: advanceReversalForm });
  const loadRequestRef = useRef(0);
  useEffect(() => { if (stage !== "new-employee") return; setOnboardingOpen(true); consumeHrRouteStage(section); }, [section, stage]);
  useEffect(() => {
    if (section !== 1 && section !== 4) { setEmployeeSearch(""); return; }
    const timeout = window.setTimeout(() => setEmployeeSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search, section]);

  const load = useCallback(async (): Promise<boolean> => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return false; }
    const requestNumber = ++loadRequestRef.current;
    setLoading(true);
    try {
      // The employee register must remain available even when an unrelated
      // advances/discounts request has a finance configuration problem.
      const employeeReceipt = await listHrEmployees(current, { status: section === 1 && employeeStatusFilter !== "ALL" ? employeeStatusFilter : undefined, search: section === 1 ? employeeSearch || undefined : undefined });
      if (requestNumber !== loadRequestRef.current) return false;
      setEmployees(employeeReceipt.employees); setOverview(employeeReceipt.summary); setNextEmployeeCursor(employeeReceipt.nextCursor);
      if (isAdvance) {
        // These registers are independent. A permission or service failure in
        // deductions must never make the migrated advances look absent (and vice versa).
        const [advanceResult, deductionResult] = await Promise.allSettled([
          listHrAdvances(current, { employeeId: employeeFilter || undefined, search: employeeSearch || undefined }),
          listHrAdministrativeDeductions(current, { employeeId: employeeFilter || undefined, search: employeeSearch || undefined }),
        ]);
        if (requestNumber !== loadRequestRef.current) return false;
        if (advanceResult.status === "fulfilled") {
          setAdvances(advanceResult.value.advances); setNextAdvanceCursor(advanceResult.value.nextCursor); setAdvanceLoadError(null);
        } else {
          const message = presentBaseerLoadError(advanceResult.reason, language, { ar: "السلف", en: "advances" });
          setAdvances([]); setNextAdvanceCursor(null); setAdvanceLoadError(message);
        }
        if (deductionResult.status === "fulfilled") {
          setDeductions(deductionResult.value.deductions); setNextDeductionCursor(deductionResult.value.nextCursor); setDeductionLoadError(null);
        } else {
          const message = presentBaseerLoadError(deductionResult.reason, language, { ar: "الخصومات الإدارية", en: "administrative deductions" });
          setDeductions([]); setNextDeductionCursor(null); setDeductionLoadError(message);
        }
      }
      return true;
    }
    catch (error) { showError(presentBaseerLoadError(error, language, { ar: "بيانات الموارد البشرية", en: "HR data" })); return false; }
    finally { if (requestNumber === loadRequestRef.current) setLoading(false); }
  }, [employeeFilter, employeeSearch, employeeStatusFilter, isAdvance, language, section, text.loading]);
  useEffect(() => { void load(); }, [load]);
  const loadConfiguration = useCallback(async () => { const current = activeSession(); if (!current) return null; const next = await api<FinanceConfiguration>(current, "/finance/configuration"); setConfiguration(next); return next; }, []);
  const searchEmployeeOptions = useCallback(async (query: string, signal: AbortSignal) => {
    const current = activeSession(); if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 }, { signal });
    const next = receipt.employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE");
    setEmployees((currentEmployees) => [...currentEmployees, ...next.filter((employee) => !currentEmployees.some((candidate) => candidate.id === employee.id))]);
    return next.map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}` }));
  }, [language]);
  const refreshDetail = async (employeeId: string) => { const current = activeSession(); if (current) setDetail(await getHrEmployee(current, employeeId)); };
  useEffect(() => {
    if (!employeeProfileId) { setDetail(null); return; }
    const current = activeSession();
    if (!current) return;
    let active = true;
    setDetail(null);
    void getHrEmployee(current, employeeProfileId)
      .then((next) => { if (active) setDetail(next); })
      .catch((error) => { if (active) showError(presentBaseerApiError(error, language, text.employeeFile)); });
    return () => { active = false; };
  }, [employeeProfileId, language, showError, text.employeeFile]);
  const loadMoreMovements = async () => {
    const current = activeSession();
    if (!current || !detail?.nextMovementCursor) return;
    try {
      const next = await getHrEmployee(current, detail.employee.id, detail.nextMovementCursor);
      setDetail((currentDetail) => currentDetail ? { ...next, movements: [...currentDetail.movements, ...next.movements] } : currentDetail);
    } catch (error) {
      showError(presentBaseerApiError(error, language, text.financialRecord));
    }
  };
  const loadMoreRegister = async (kind: "employees" | "advances" | "deductions") => {
    const current = activeSession();
    if (!current) return;
    try {
      if (kind === "employees" && nextEmployeeCursor) {
        const receipt = await listHrEmployees(current, { status: section === 1 && employeeStatusFilter !== "ALL" ? employeeStatusFilter : undefined, search: section === 1 ? employeeSearch || undefined : undefined, cursor: nextEmployeeCursor });
        setEmployees((rows) => [...rows, ...receipt.employees]); setNextEmployeeCursor(receipt.nextCursor);
      } else if (kind === "advances" && nextAdvanceCursor) {
        const receipt = await listHrAdvances(current, { employeeId: employeeFilter || undefined, search: employeeSearch || undefined, cursor: nextAdvanceCursor });
        setAdvances((rows) => [...rows, ...receipt.advances]); setNextAdvanceCursor(receipt.nextCursor);
      } else if (kind === "deductions" && nextDeductionCursor) {
        const receipt = await listHrAdministrativeDeductions(current, { employeeId: employeeFilter || undefined, search: employeeSearch || undefined, cursor: nextDeductionCursor });
        setDeductions((rows) => [...rows, ...receipt.deductions]); setNextDeductionCursor(receipt.nextCursor);
      }
    } catch (error) {
      showError(presentBaseerLoadError(error, language, { ar: "سجلات إضافية", en: "additional records" }));
    }
  };
  const showDetail = (employee: HrEmployee) => { window.location.hash = pageRouteHash("hr-employees", `employee-${employee.id}`); };
  const showAdvanceDetail = async (advance: HrAdvance) => { const current = activeSession(); if (!current) return; try { setAdvanceDetail(await getHrAdvance(current, advance.id)); } catch (error) { showError(presentBaseerApiError(error, language, text.advances)); } };
  const showDeductionDetail = async (deduction: HrAdministrativeDeduction) => { const current = activeSession(); if (!current) return; try { setDeductionDetail(await getHrAdministrativeDeduction(current, deduction.id)); } catch (error) { showError(presentBaseerApiError(error, language, text.administrativeDeductions)); } };
  const loadMoreAdvanceSettlements = async () => { const current = activeSession(); if (!current || !advanceDetail?.nextSettlementCursor) return; try { const receipt = await getHrAdvance(current, advanceDetail.advance.id, { settlementCursor: advanceDetail.nextSettlementCursor, settlementPageSize: 50 }); setAdvanceDetail((detail) => detail ? { ...detail, settlements: [...detail.settlements, ...receipt.settlements.filter((item) => !detail.settlements.some((existing) => existing.id === item.id))], hasMoreSettlements: receipt.hasMoreSettlements, nextSettlementCursor: receipt.nextSettlementCursor } : detail); } catch (error) { showError(presentBaseerLoadError(error, language, { ar: "سجلات إضافية", en: "additional records" })); } };
  const loadMoreAdvanceDeferrals = async () => { const current = activeSession(); if (!current || !advanceDetail?.nextDeferralCursor) return; try { const receipt = await getHrAdvance(current, advanceDetail.advance.id, { deferralCursor: advanceDetail.nextDeferralCursor, deferralPageSize: 50 }); setAdvanceDetail((detail) => detail ? { ...detail, deferrals: [...detail.deferrals, ...receipt.deferrals.filter((item) => !detail.deferrals.some((existing) => existing.id === item.id))], hasMoreDeferrals: receipt.hasMoreDeferrals, nextDeferralCursor: receipt.nextDeferralCursor } : detail); } catch (error) { showError(presentBaseerLoadError(error, language, { ar: "سجلات إضافية", en: "additional records" })); } };
  const loadMoreDeductionActions = async () => { const current = activeSession(); if (!current || !deductionDetail?.nextActionCursor) return; try { const receipt = await getHrAdministrativeDeduction(current, deductionDetail.deduction.id, { actionCursor: deductionDetail.nextActionCursor, actionPageSize: 50 }); setDeductionDetail((detail) => detail ? { ...detail, actions: [...detail.actions, ...receipt.actions.filter((item) => !detail.actions.some((existing) => existing.id === item.id))], hasMoreActions: receipt.hasMoreActions, nextActionCursor: receipt.nextActionCursor } : detail); } catch (error) { showError(presentBaseerLoadError(error, language, { ar: "سجلات إضافية", en: "additional records" })); } };
  const openEmployeeEdit = (employee: HrEmployee) => { setEditingEmployeeId(employee.id); setAdditionalEmployeeInfoOpen(false); setEmployeeForm({ employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn ?? "", jobTitle: employee.jobTitle ?? "", phone: employee.phone ?? "", email: employee.email ?? "", iqamaNumber: employee.iqamaNumber ?? "", workSchedule: employee.workSchedule ?? "", hireDate: employee.hireDate, status: employee.status, statusEffectiveAt: employee.statusEffectiveAt ?? employee.terminatedAt ?? "", statusReason: employee.statusReason ?? "", notes: employee.notes ?? "" }); setEmployeeOpen(true); };
  const saveEmployee = async () => { const current = activeSession(); if (!current || saving || !editingEmployeeId) return; setSaving(true); try { const needsStatusDetails = employeeForm.status === "TERMINATED" || employeeForm.status === "ARCHIVED"; await updateHrEmployee(current, { employeeId: editingEmployeeId, nameAr: employeeForm.nameAr, nameEn: employeeForm.nameEn || null, jobTitle: employeeForm.jobTitle || null, phone: employeeForm.phone || null, email: employeeForm.email || null, iqamaNumber: employeeForm.iqamaNumber || null, workSchedule: employeeForm.workSchedule || null, status: employeeForm.status, terminatedAt: employeeForm.status === "TERMINATED" ? employeeForm.statusEffectiveAt : null, statusEffectiveAt: needsStatusDetails ? employeeForm.statusEffectiveAt : null, statusReason: needsStatusDetails ? employeeForm.statusReason : null, notes: employeeForm.notes || null, idempotencyKey: requestId() }); const updatedId = editingEmployeeId; setEmployeeOpen(false); setEditingEmployeeId(null); setEmployeeForm(emptyEmployee()); showSuccess(text.employeeUpdated); await load(); if (detail?.employee.id === updatedId) await refreshDetail(updatedId); } catch (error) { showError(presentBaseerApiError(error, language, text.employeeUpdated)); } finally { setSaving(false); } };
  const openAdvance = async () => { try { const next = configuration ?? await loadConfiguration(); const firstVault = next?.vaults.find((item) => item.status === "ACTIVE" && item.isPaymentDestination); setAdvanceForm(emptyAdvance("", firstVault?.id ?? "", firstVault?.paymentMethod ?? "")); setAdvanceOpen(true); } catch (error) { showError(presentBaseerApiError(error, language, text.addAdvance)); } };
  const saveAdvance = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await issueHrEmployeeAdvance(current, { employeeId: advanceForm.employeeId, businessDate: advanceForm.businessDate, amount: advanceForm.amount, notes: advanceForm.notes || undefined, allocations: [{ vaultId: advanceForm.vaultId, amount: advanceForm.amount, paymentMethod: advanceForm.paymentMethod || undefined }], idempotencyKey: requestId() }); setAdvanceOpen(false); showSuccess(text.advanceSaved); await load(); if (detail?.employee.id === advanceForm.employeeId) await refreshDetail(advanceForm.employeeId); } catch (error) { showError(presentBaseerApiError(error, language, text.addAdvance)); } finally { setSaving(false); } };
  const openSettlement = async (advance: HrAdvance) => { try { const next = configuration ?? await loadConfiguration(); const firstVault = next?.vaults.find((item) => item.status === "ACTIVE" && item.isPaymentDestination); setSettlementForm(emptySettlement(advance.id, advance.remainingAmount, firstVault?.id ?? "", firstVault?.paymentMethod ?? "")); setSettlementOpen(true); } catch (error) { showError(presentBaseerApiError(error, language, text.settleAdvance)); } };
  const saveSettlement = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await settleHrEmployeeAdvanceDirectly(current, { advanceId: settlementForm.advanceId, businessDate: settlementForm.businessDate, amount: settlementForm.amount, deferRemainingUntil: settlementForm.deferRemainingUntil || undefined, notes: settlementForm.notes || undefined, allocations: settlementForm.allocations.map((item) => ({ vaultId: item.vaultId, amount: item.amount, paymentMethod: item.paymentMethod || undefined })), idempotencyKey: requestId() }); setSettlementOpen(false); showSuccess(text.settlementSaved); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.settleAdvance)); } finally { setSaving(false); } };
  const saveAdvanceReversal = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await reverseHrEmployeeAdvanceIssue(current, { ...advanceReversalForm, idempotencyKey: requestId() }); setAdvanceReversalOpen(false); setAdvanceDetail(null); showSuccess(language === "ar" ? "تم إلغاء إصدار السلفة." : "The advance issue was cancelled."); await load(); } catch (error) { showError(presentBaseerApiError(error, language, language === "ar" ? "إلغاء إصدار السلفة" : "Cancelling advance issue")); } finally { setSaving(false); } };
  const openDeferral = (advance: HrAdvance) => { setDeferralForm({ ...emptyDeferral(advance.id), deferredUntil: advance.nextSettlementDate ?? futureDate(30) }); setDeferralOpen(true); };
  const saveDeferral = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await deferHrEmployeeAdvance(current, { ...deferralForm, idempotencyKey: requestId() }); setDeferralOpen(false); showSuccess(text.deferralSaved); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.deferAdvance)); } finally { setSaving(false); } };
  const saveDeduction = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await createHrEmployeeAdministrativeDeduction(current, { ...deductionForm, plannedPayrollDate: deductionForm.plannedPayrollDate || undefined, idempotencyKey: requestId() }); setDeductionOpen(false); setDeductionForm(emptyDeduction()); showSuccess(text.deductionSaved); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.addAdministrativeDeduction)); } finally { setSaving(false); } };
  const openDeductionDeferral = (deduction: HrAdministrativeDeduction) => { setDeductionDeferralForm({ ...emptyDeductionDeferral(deduction.id), deferredUntil: deduction.plannedPayrollDate ?? futureDate(30) }); setDeductionDeferralOpen(true); };
  const saveDeductionDeferral = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await deferHrEmployeeAdministrativeDeduction(current, { ...deductionDeferralForm, idempotencyKey: requestId() }); setDeductionDeferralOpen(false); showSuccess(text.deductionDeferred); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.deferDeduction)); } finally { setSaving(false); } };
  const openDeductionCancellation = (deduction: HrAdministrativeDeduction) => { setDeductionCancellationForm(emptyDeductionCancellation(deduction.id)); setDeductionCancellationOpen(true); };
  const saveDeductionCancellation = async () => { const current = activeSession(); if (!current || saving) return; setSaving(true); try { await cancelHrEmployeeAdministrativeDeduction(current, { ...deductionCancellationForm, idempotencyKey: requestId() }); setDeductionCancellationOpen(false); showSuccess(text.deductionCancelled); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.cancelDeduction)); } finally { setSaving(false); } };

  const visibleEmployees = useMemo(() => filter(employees.filter((item) => employeeStatusFilter === "ALL" || item.status === employeeStatusFilter), search, (item) => [item.employeeNumber, item.nameAr, item.nameEn, item.jobTitle]), [employeeStatusFilter, employees, search]);
  const visibleAdvances = useMemo(() => filter(advances.filter((item) => !employeeFilter || item.employeeId === employeeFilter), search, (item) => [item.advanceNumber, item.employeeNameAr, item.employeeNameEn, item.notes]), [advances, employeeFilter, search]);
  const visibleDeductions = useMemo(() => filter(deductions.filter((item) => !employeeFilter || item.employeeId === employeeFilter), search, (item) => [item.deductionNumber, item.employeeNameAr, item.employeeNameEn, item.description, item.status]), [deductions, employeeFilter, search]);
  const statusLabel = (status: HrEmployeeStatus) => ({ ACTIVE: text.active, ON_LEAVE: text.onLeave, TERMINATED: text.terminated, ARCHIVED: text.archived })[status];
  const employeeStatusOptions = [{ id: "ACTIVE", label: text.active }, { id: "ON_LEAVE", label: text.onLeave }, { id: "TERMINATED", label: language === "ar" ? "مفصول" : text.terminated }, { id: "ARCHIVED", label: text.archived }, { id: "ALL", label: language === "ar" ? "كل الحالات" : "All statuses" }];
  const sectionTitle = [text.overview, text.employees, language === "ar" ? "الإجازات والعودة" : "Leave & return", language === "ar" ? "الرواتب" : "Payroll", language === "ar" ? "السلف والخصومات" : "Advances & deductions", text.services][section] ?? text.title;
  const employeeColumns: readonly BaseerDataGridColumn<HrEmployee>[] = [
    { id: "number", header: text.employeeNumber, cell: (row) => row.employeeNumber, width: "9rem", sort: (row) => row.employeeNumber },
    { id: "name", header: text.employeeName, cell: (row) => <button type="button" className="baseer-link-button" onClick={() => void showDetail(row)}>{language === "ar" ? row.nameAr : row.nameEn ?? row.nameAr}</button>, sort: (row) => language === "ar" ? row.nameAr : row.nameEn ?? row.nameAr },
    { id: "job", header: text.jobTitle, cell: (row) => row.jobTitle ?? "—", sort: (row) => row.jobTitle },
    { id: "hire", header: text.hireDate, cell: (row) => row.hireDate, width: "9rem", sort: (row) => row.hireDate },
    { id: "salary", header: text.monthlySalary, cell: (row) => row.currentMonthlyGross ? <BaseerMoney value={row.currentMonthlyGross} language={language} /> : "—", align: "end", numeric: true, width: "10rem", sort: (row) => row.currentMonthlyGross ?? "" },
    { id: "status", header: text.status, cell: (row) => <BaseerStatusBadge tone={row.status === "ACTIVE" ? "success" : row.status === "ON_LEAVE" ? "warning" : "neutral"}>{statusLabel(row.status)}</BaseerStatusBadge>, width: "8rem", sort: (row) => row.status },
  ];
  const advanceColumns: readonly BaseerDataGridColumn<HrAdvance>[] = [
    { id: "number", header: text.advanceNumber, cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => void showAdvanceDetail(row)}>{row.advanceNumber}</BaseerButton>, width: "13rem", sort: (row) => row.advanceNumber },
    { id: "employee", header: text.employeeName, cell: (row) => language === "ar" ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr, sort: (row) => language === "ar" ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr },
    { id: "date", header: text.date, cell: (row) => row.businessDate, width: "9rem", sort: (row) => row.businessDate },
    { id: "original", header: text.originalAmount, cell: (row) => <BaseerMoney value={row.originalAmount} language={language} />, align: "end", numeric: true, width: "9rem", sort: (row) => row.originalAmount },
    { id: "remaining", header: text.remainingAmount, cell: (row) => <BaseerMoney value={row.remainingAmount} language={language} />, align: "end", numeric: true, width: "10rem", sort: (row) => row.remainingAmount },
    { id: "next", header: text.nextSettlementDate, cell: (row) => row.nextSettlementDate ?? "—", width: "11rem", sort: (row) => row.nextSettlementDate },
    { id: "settle", header: text.settleAdvance, cell: (row) => canSettleAdvance && row.remainingAmount !== "0.0000" ? <BaseerButton type="button" variant="secondary" onClick={() => void openSettlement(row)}>{text.settleAdvance}</BaseerButton> : "—", width: "11rem" },
    { id: "defer", header: text.deferAdvance, cell: (row) => row.remainingAmount !== "0.0000" ? <BaseerButton type="button" variant="quiet" onClick={() => openDeferral(row)}>{text.deferAdvance}</BaseerButton> : "—", width: "11rem" },
  ];
  const deductionColumns: readonly BaseerDataGridColumn<HrAdministrativeDeduction>[] = [
    { id: "number", header: text.deductionNumber, cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => void showDeductionDetail(row)}>{row.deductionNumber}</BaseerButton>, width: "13rem", sort: (row) => row.deductionNumber },
    { id: "employee", header: text.employeeName, cell: (row) => language === "ar" ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr, sort: (row) => language === "ar" ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr },
    { id: "description", header: text.deductionDescription, cell: (row) => row.description, sort: (row) => row.description },
    { id: "amount", header: text.originalAmount, cell: (row) => <BaseerMoney value={row.originalAmount} language={language} />, align: "end", numeric: true, width: "9rem", sort: (row) => row.originalAmount },
    { id: "remaining", header: text.remainingAmount, cell: (row) => <BaseerMoney value={row.remainingAmount} language={language} />, align: "end", numeric: true, width: "10rem", sort: (row) => row.remainingAmount },
    { id: "date", header: text.plannedPayrollDate, cell: (row) => row.plannedPayrollDate ?? "—", width: "11rem", sort: (row) => row.plannedPayrollDate },
    { id: "status", header: text.status, cell: (row) => <BaseerStatusBadge tone={row.status === "APPLIED" ? "success" : row.status === "CANCELLED" ? "neutral" : row.status === "DEFERRED" ? "warning" : "info"}>{deductionStatusLabel(text, row.status)}</BaseerStatusBadge>, width: "9rem", sort: (row) => row.status },
    { id: "defer", header: text.deferDeduction, cell: (row) => deductionIsOpen(row) ? <BaseerButton type="button" variant="quiet" onClick={() => openDeductionDeferral(row)}>{text.deferDeduction}</BaseerButton> : "—", width: "11rem" },
    { id: "cancel", header: text.cancelDeduction, cell: (row) => deductionIsOpen(row) ? <BaseerButton type="button" variant="quiet" onClick={() => openDeductionCancellation(row)}>{text.cancelDeduction}</BaseerButton> : "—", width: "11rem" },
  ];
  const activeEmployees = employees.filter((item) => item.status === "ACTIVE" || item.status === "ON_LEAVE");
  const activeVaults = configuration?.vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination) ?? [];
  const createEmployeeAction = canManageEmployees ? <BaseerButton type="button" onClick={() => setOnboardingOpen(true)}>{text.addEmployee}</BaseerButton> : undefined;

  if (!session) return <Suspense fallback={<BaseerCard>{text.loading}</BaseerCard>}><DailySalesSignIn language={language} /></Suspense>;
  return <BaseerWorkspace className={section === 1 ? "hr-employees-workspace" : undefined} aria-label={text.title}>
    <BaseerSectionHeader eyebrow={section === 0 ? (language === "ar" ? "مركز عمل الموارد البشرية" : "HR operations hub") : undefined} title={sectionTitle} actions={section === 1 && canManageEmployees ? <BaseerButton type="button" variant="primary" onClick={() => setOnboardingOpen(true)}>{text.addEmployee}</BaseerButton> : isAdvance ? <>{canIssueAdvance ? <BaseerButton type="button" variant="primary" onClick={() => void openAdvance()}>{text.addAdvance}</BaseerButton> : null}{canManageDeductions ? <BaseerButton type="button" variant="secondary" onClick={() => { setDeductionForm(emptyDeduction()); setDeductionOpen(true); }}>{text.addAdministrativeDeduction}</BaseerButton> : null}</> : undefined} />
    {message ? <BaseerNotice tone={message.tone}>{message.text}</BaseerNotice> : null}
    {section === 0 ? (
      <>
        <BaseerSummaryMetricGrid><BaseerSummaryMetric label={text.active} value={String(overview.activeEmployees)} /><BaseerSummaryMetric label={text.onLeave} value={String(overview.employeesOnLeave)} /><BaseerSummaryMetric label={text.advances} value={String(overview.openAdvances)} /><BaseerSummaryMetric label={text.administrativeDeductions} value={String(overview.openAdministrativeDeductions)} /></BaseerSummaryMetricGrid>
      </>
    ) : (
      <>
        <BaseerFilterBar controlsPresentation={section === 1 ? "menu" : "inline"} language={language} search={search} searchLabel={sectionTitle} searchPlaceholder={sectionTitle} onSearchChange={setSearch} controls={section === 1 ? <BaseerFilterSelect label={language === "ar" ? "نوع الموظف" : "Employee status"} value={employeeStatusFilter} onChange={(event) => setEmployeeStatusFilter(event.target.value as HrEmployeeStatus | "ALL")}>{employeeStatusOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</BaseerFilterSelect> : isAdvance ? <BaseerCombobox label={text.selectEmployee} value={employeeFilter} placeholder={text.selectEmployee} options={activeEmployees.map((item) => ({ id: item.id, label: `${item.employeeNumber} · ${language === "ar" ? item.nameAr : (item.nameEn ?? item.nameAr)}` }))} remoteSearch={searchEmployeeOptions} scopeKey={session?.companyId ?? "signed-out"} onChange={setEmployeeFilter} /> : undefined} appliedFilters={[...(search ? [{ id: "q", label: search, onRemove: () => setSearch("") }] : []), ...(section === 1 && employeeStatusFilter !== "ACTIVE" ? [{ id: "employee-status", label: employeeStatusOptions.find((item) => item.id === employeeStatusFilter)?.label ?? employeeStatusFilter, onRemove: () => setEmployeeStatusFilter("ACTIVE") }] : []), ...(employeeFilter ? [{ id: "employee", label: activeEmployees.find((item) => item.id === employeeFilter)?.nameAr ?? employeeFilter, onRemove: () => setEmployeeFilter("") }] : [])]} onClear={() => { setSearch(""); setEmployeeFilter(""); setEmployeeStatusFilter("ACTIVE"); }} />
        {loading ? <BaseerCard><p>{text.loading}</p></BaseerCard> : isAdvance ? (
          <>
            {advanceLoadError ? <BaseerNotice tone="danger" title={language === "ar" ? "تعذر تحميل السلف" : "Unable to load advances"}>{advanceLoadError} <BaseerButton type="button" variant="quiet" onClick={() => void load()}>{language === "ar" ? "إعادة المحاولة" : "Retry"}</BaseerButton></BaseerNotice> : visibleAdvances.length ? <BaseerDataGrid ariaLabel={text.advances} caption={text.advances} columns={advanceColumns} rows={visibleAdvances} rowKey={(row) => row.id} /> : <BaseerEmptyState title={language === "ar" ? "لا توجد سلف مسجلة" : "No advances recorded"} />}
            {deductionLoadError ? <BaseerNotice tone="danger" title={language === "ar" ? "تعذر تحميل الخصومات" : "Unable to load deductions"}>{deductionLoadError} <BaseerButton type="button" variant="quiet" onClick={() => void load()}>{language === "ar" ? "إعادة المحاولة" : "Retry"}</BaseerButton></BaseerNotice> : visibleDeductions.length ? <BaseerDataGrid ariaLabel={text.administrativeDeductions} caption={text.administrativeDeductions} columns={deductionColumns} rows={visibleDeductions} rowKey={(row) => row.id} /> : <BaseerEmptyState title={language === "ar" ? "لا توجد خصومات إدارية" : "No administrative deductions"} />}
          </>
        ) : visibleEmployees.length ? <><div className="hr-employee-view-switch" role="group" aria-label={language === "ar" ? "طريقة عرض الموظفين" : "Employee display mode"}><BaseerButton type="button" className="hr-employee-view-switch__button" variant={employeeView === "cards" ? "primary" : "secondary"} onClick={() => setEmployeeView("cards")} aria-label={language === "ar" ? "عرض البطاقات" : "Card view"} title={language === "ar" ? "عرض البطاقات" : "Card view"} aria-pressed={employeeView === "cards"}><EmployeeViewIcon view="cards" /></BaseerButton><BaseerButton type="button" className="hr-employee-view-switch__button" variant={employeeView === "table" ? "primary" : "secondary"} onClick={() => setEmployeeView("table")} aria-label={language === "ar" ? "عرض الجدول" : "Table view"} title={language === "ar" ? "عرض الجدول" : "Table view"} aria-pressed={employeeView === "table"}><EmployeeViewIcon view="table" /></BaseerButton></div>{employeeView === "cards" ? <HrEmployeeDirectoryGrid employees={visibleEmployees} language={language} onOpen={(employee) => void showDetail(employee)} /> : <BaseerDataGrid ariaLabel={sectionTitle} caption={sectionTitle} columns={employeeColumns} rows={visibleEmployees} rowKey={(row) => row.id} />}</> : <BaseerEmptyState title={text.noEmployees} action={createEmployeeAction} />}
      </>
    )}
    {!loading && section === 1 && nextEmployeeCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void loadMoreRegister("employees")}>{text.loadMore}</BaseerButton> : null}
    {!loading && isAdvance && (nextAdvanceCursor || nextDeductionCursor) ? <BaseerButton type="button" variant="secondary" onClick={() => { if (nextAdvanceCursor) void loadMoreRegister("advances"); if (nextDeductionCursor) void loadMoreRegister("deductions"); }}>{text.loadMore}</BaseerButton> : null}

    {onboardingOpen ? <Suspense fallback={null}><HrEmployeeOnboardingDialog open language={language} onClose={() => setOnboardingOpen(false)} onSaved={async () => { const refreshed = await load(); if (refreshed) showSuccess(text.employeeSaved); return refreshed; }} onError={showError} /></Suspense> : null}
    <BaseerFormDialog open={employeeOpen} title={text.editEmployee} language={language} busy={saving} size="standard" className="hr-employee-edit-dialog" formId="hr-employee-form" submitLabel={text.save} onClose={() => { setEmployeeOpen(false); setEditingEmployeeId(null); setAdditionalEmployeeInfoOpen(false); }}>
      <form id="hr-employee-form" className="baseer-form hr-employee-edit" data-baseer-rhf-form="true" noValidate onSubmit={employeeState.handleSubmit(() => void saveEmployee())}>
        <div className="hr-employee-edit__meta"><span><small>{text.employeeNumber}</small><bdi>{employeeForm.employeeNumber}</bdi></span><span><small>{text.hireDate}</small><bdi>{employeeForm.hireDate}</bdi></span></div>
        <BaseerFormGrid className="hr-employee-edit__core">
          <label className="baseer-form-field">{text.employeeName}<BaseerTextInput required autoFocus aria-invalid={Boolean(employeeState.formState.errors.nameAr)} value={employeeForm.nameAr} onChange={(event) => setEmployeeForm((value) => ({ ...value, nameAr: event.target.value }))} />{employeeState.formState.errors.nameAr ? <small role="alert">{employeeState.formState.errors.nameAr.message}</small> : null}</label>
          <label className="baseer-form-field">{text.jobTitle}<HrJobTitleSelect id="hr-edit-job-titles" language={language} value={employeeForm.jobTitle} onChange={(jobTitle) => setEmployeeForm((value) => ({ ...value, jobTitle }))} /></label>
          <label className="baseer-form-field">{text.status}<BaseerCombobox searchable={false} required label={text.status} value={employeeForm.status} placeholder={text.status} options={(["ACTIVE", "ON_LEAVE", "TERMINATED", "ARCHIVED"] as const).map((status) => ({ id: status, label: statusLabel(status) }))} onChange={(status) => setEmployeeForm((value) => ({ ...value, status: status as HrEmployeeStatus, statusEffectiveAt: status === "TERMINATED" || status === "ARCHIVED" ? value.statusEffectiveAt : "", statusReason: status === "TERMINATED" || status === "ARCHIVED" ? value.statusReason : "" }))} /></label>
          {employeeForm.status === "TERMINATED" || employeeForm.status === "ARCHIVED" ? <><label className="baseer-form-field">{language === "ar" ? employeeForm.status === "TERMINATED" ? "تاريخ انتهاء الخدمة" : "تاريخ الأرشفة" : employeeForm.status === "TERMINATED" ? "End-of-service date" : "Archive date"}<BaseerDatePicker language={language} label={language === "ar" ? "تاريخ الحالة" : "Status date"} min={employeeForm.hireDate} max={today()} value={employeeForm.statusEffectiveAt} onChange={(statusEffectiveAt) => setEmployeeForm((value) => ({ ...value, statusEffectiveAt }))} /></label><label className="baseer-form-field">{language === "ar" ? employeeForm.status === "TERMINATED" ? "سبب انتهاء الخدمة" : "سبب الأرشفة" : employeeForm.status === "TERMINATED" ? "End-of-service reason" : "Archive reason"}<BaseerTextInput required value={employeeForm.statusReason} placeholder={language === "ar" ? employeeForm.status === "TERMINATED" ? "مثل استقالة أو فصل" : "أدخل سبب الأرشفة" : employeeForm.status === "TERMINATED" ? "For example, resignation or dismissal" : "Enter the archive reason"} onChange={(event) => setEmployeeForm((value) => ({ ...value, statusReason: event.target.value }))} /></label></> : null}
        </BaseerFormGrid>
        <BaseerButton type="button" variant="quiet" className="hr-employee-edit__additional-toggle" aria-expanded={additionalEmployeeInfoOpen} onClick={() => setAdditionalEmployeeInfoOpen((value) => !value)}><span>{language === "ar" ? "معلومات إضافية" : "Additional information"}</span><b aria-hidden="true">{additionalEmployeeInfoOpen ? "−" : "+"}</b></BaseerButton>
        {additionalEmployeeInfoOpen ? <BaseerFormGrid className="hr-employee-edit__additional-fields"><label className="baseer-form-field">{text.englishName}<BaseerTextInput dir="ltr" value={employeeForm.nameEn} onChange={(event) => setEmployeeForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label className="baseer-form-field">{language === "ar" ? "رقم الإقامة" : "Iqama number"}<input inputMode="numeric" value={employeeForm.iqamaNumber} onChange={(event) => setEmployeeForm((value) => ({ ...value, iqamaNumber: event.target.value }))} /></label><label className="baseer-form-field">{text.phone}<BaseerTextInput dir="ltr" inputMode="tel" value={employeeForm.phone} onChange={(event) => setEmployeeForm((value) => ({ ...value, phone: event.target.value }))} /></label><label className="baseer-form-field">{text.email}<BaseerTextInput dir="ltr" type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm((value) => ({ ...value, email: event.target.value }))} /></label></BaseerFormGrid> : null}
        <BaseerFormGrid columns="one"><label className="baseer-form-field hr-employee-edit__notes">{text.notes}<textarea rows={1} value={employeeForm.notes} onChange={(event) => setEmployeeForm((value) => ({ ...value, notes: event.target.value }))} /></label></BaseerFormGrid>
      </form>
    </BaseerFormDialog>
    {detail ? <Suspense fallback={null}>{employeeProfileId ? <HrEmployeeProfilePage detail={detail} language={language} onClose={() => { window.location.hash = pageRouteHash("hr-employees"); }} onEdit={() => openEmployeeEdit(detail.employee)} onManageCompensation={() => setCompensationTarget({ employee: detail.employee, profile: detail.compensation })} onLoadMoreMovements={loadMoreMovements} onError={showError} onChanged={async () => { await load(); await refreshDetail(detail.employee.id); }} /> : <HrEmployeeProfileDialog detail={detail} language={language} onClose={() => setDetail(null)} onEdit={() => { openEmployeeEdit(detail.employee); setDetail(null); }} onManageCompensation={() => { setCompensationTarget({ employee: detail.employee, profile: detail.compensation }); setDetail(null); }} onLoadMoreMovements={loadMoreMovements} onError={showError} onChanged={async () => { await load(); await refreshDetail(detail.employee.id); }} />}</Suspense> : null}
    {compensationTarget ? <Suspense fallback={null}><HrCompensationAgreementDialog open language={language} employees={employees} fixedEmployeeId={compensationTarget.employee.id} profile={compensationTarget.profile} onClose={() => setCompensationTarget(null)} onSaved={async () => { await load(); await refreshDetail(compensationTarget.employee.id); showSuccess(language === "ar" ? "تم حفظ الراتب؛ ستظهر البدلات وتفاصيل الأوفر تايم تلقائيًا في ملف الموظف." : "Salary saved; allowances and overtime details now update automatically in the employee file."); }} onError={showError} /></Suspense> : null}
    <BaseerDialog open={advanceDetail !== null} title={advanceDetail?.advance.advanceNumber ?? text.advances} language={language} onClose={() => setAdvanceDetail(null)} footer={advanceDetail ? <>{hasActivePermission("hr.advances.reverse") && advanceDetail.advance.status === "ISSUED" && advanceDetail.settlements.length === 0 && !advanceDetail.hasMoreSettlements ? <BaseerButton type="button" variant="danger" onClick={() => { setAdvanceReversalForm({ advanceId: advanceDetail.advance.id, businessDate: today(), reason: "" }); setAdvanceReversalOpen(true); }}>{language === "ar" ? "إلغاء إصدار السلفة" : "Cancel advance issue"}</BaseerButton> : null}<BaseerButton type="button" variant="secondary" onClick={() => setAdvanceDetail(null)}>{text.cancel}</BaseerButton></> : undefined}>{advanceDetail ? <div className="administration-list"><article><strong>{language === "ar" ? advanceDetail.advance.employeeNameAr : advanceDetail.advance.employeeNameEn ?? advanceDetail.advance.employeeNameAr}</strong><span>{text.originalAmount}: <BaseerMoney value={advanceDetail.advance.originalAmount} language={language} /></span><span>{text.remainingAmount}: <BaseerMoney value={advanceDetail.advance.remainingAmount} language={language} /></span><span>{text.status}: {hrEnumLabel(language, advanceDetail.advance.status)}</span></article><article><strong>{language === "ar" ? "الملاحظات" : "Notes"}</strong><span>{advanceDetail.advance.notes ?? "—"}</span>{advanceDetail.sourceAnnotations.length ? <><strong>{language === "ar" ? "ملاحظات المصدر الأصلية" : "Original source notes"}</strong>{advanceDetail.sourceAnnotations.map((item) => <span key={`${item.sourceEntity}:${item.sourceId}:${item.field}`}>{item.exactText}</span>)}</> : null}</article><article><strong>{text.settleAdvance}</strong>{advanceDetail.settlements.length ? advanceDetail.settlements.map((item) => <span key={item.id}>{item.businessDate} · <BaseerMoney value={item.amount} language={language} /> · {item.source === "PAYROLL" ? text.payrollPayment : text.settleAdvance} · {item.sourceReference ?? "—"}{item.sourceNotes.map((note, index) => <small key={`${item.id}:note:${index}`}>{language === "ar" ? "ملاحظة نوركس: " : "Noorix note: "}{note}</small>)}</span>) : <span>—</span>}{advanceDetail.nextSettlementCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void loadMoreAdvanceSettlements()}>{text.loadMore}</BaseerButton> : null}</article><article><strong>{text.deferAdvance}</strong>{advanceDetail.deferrals.length ? advanceDetail.deferrals.map((item) => <span key={item.id}>{item.businessDate} · {item.deferredUntil} · {item.reason}</span>) : <span>—</span>}{advanceDetail.nextDeferralCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void loadMoreAdvanceDeferrals()}>{text.loadMore}</BaseerButton> : null}</article></div> : null}</BaseerDialog>
    <BaseerDialog open={deductionDetail !== null} title={deductionDetail?.deduction.deductionNumber ?? text.administrativeDeductions} language={language} onClose={() => setDeductionDetail(null)} footer={<BaseerButton type="button" variant="secondary" onClick={() => setDeductionDetail(null)}>{text.cancel}</BaseerButton>}>{deductionDetail ? <div className="administration-list"><article><strong>{language === "ar" ? deductionDetail.deduction.employeeNameAr : deductionDetail.deduction.employeeNameEn ?? deductionDetail.deduction.employeeNameAr}</strong><span>{text.deductionDescription}: {deductionDetail.deduction.description}</span><span>{text.originalAmount}: <BaseerMoney value={deductionDetail.deduction.originalAmount} language={language} /></span><span>{text.remainingAmount}: <BaseerMoney value={deductionDetail.deduction.remainingAmount} language={language} /></span></article><article><strong>{text.financialRecord}</strong>{deductionDetail.actions.length ? deductionDetail.actions.map((item) => <span key={item.id}>{item.businessDate} · {deductionActionLabel(text, item.actionType)} · {item.amount ? <BaseerMoney value={item.amount} language={language} /> : "—"} · {item.plannedPayrollDate ?? item.reason ?? "—"}</span>) : <span>—</span>}{deductionDetail.nextActionCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void loadMoreDeductionActions()}>{text.loadMore}</BaseerButton> : null}</article></div> : null}</BaseerDialog>
    <BaseerFormDialog open={advanceOpen} title={text.addAdvance} language={language} busy={saving} size="standard" formId="hr-advance-form" submitLabel={text.save} onClose={() => setAdvanceOpen(false)}>
      <form id="hr-advance-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={advanceState.handleSubmit(() => void saveAdvance())}>
        <BaseerFormSection title={language === "ar" ? "بيانات السلفة" : "Advance details"}>
          <BaseerFormGrid>
            <label className="baseer-form-field baseer-form-field--full">{text.selectEmployee}<BaseerCombobox required label={text.selectEmployee} value={advanceForm.employeeId} placeholder={text.selectEmployee} options={activeEmployees.map((item) => ({ id: item.id, label: `${item.employeeNumber} · ${language === "ar" ? item.nameAr : item.nameEn ?? item.nameAr}` }))} remoteSearch={searchEmployeeOptions} scopeKey={session?.companyId ?? "signed-out"} onChange={(employeeId) => setAdvanceForm((value) => ({ ...value, employeeId }))} /></label>
            <label className="baseer-form-field">{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={advanceForm.businessDate} onChange={(businessDate) => setAdvanceForm((value) => ({ ...value, businessDate }))} /></label>
            <label className="baseer-form-field">{text.originalAmount}<BaseerMoneyInput required value={advanceForm.amount} onValueChange={(amount) => setAdvanceForm((value) => ({ ...value, amount }))} />{advanceState.formState.errors.amount ? <small role="alert">{advanceState.formState.errors.amount.message}</small> : null}</label>
          </BaseerFormGrid>
        </BaseerFormSection>
        <BaseerFormSection title={language === "ar" ? "مصدر الصرف" : "Payment source"}>
          <BaseerFormGrid>
            <label className="baseer-form-field">{text.selectVault}<BaseerCombobox required label={text.selectVault} value={advanceForm.vaultId} placeholder={text.selectVault} options={activeVaults.map((item) => ({ id: item.id, label: language === "ar" ? item.nameAr : item.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setAdvanceForm((value) => ({ ...value, vaultId, paymentMethod: vault?.paymentMethod ?? "" })); }} /></label>
            <label className="baseer-form-field">{language === "ar" ? "طريقة السداد" : "Payment method"}<BaseerCombobox searchable={false} required label={language === "ar" ? "طريقة السداد" : "Payment method"} value={advanceForm.paymentMethod} placeholder={language === "ar" ? "طريقة السداد" : "Payment method"} options={(activeVaults.find((item) => item.id === advanceForm.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => setAdvanceForm((value) => ({ ...value, paymentMethod: paymentMethod as AdvanceAllocation["paymentMethod"] }))} /></label>
            <label className="baseer-form-field baseer-form-field--full">{text.notes}<BaseerTextArea compact value={advanceForm.notes} onValueChange={(notes) => setAdvanceForm((value) => ({ ...value, notes }))} /></label>
          </BaseerFormGrid>
        </BaseerFormSection>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={settlementOpen} title={text.settleAdvance} language={language} busy={saving} size="standard" formId="hr-advance-settlement-form" submitLabel={text.save} onClose={() => setSettlementOpen(false)}>
      <form id="hr-advance-settlement-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={settlementState.handleSubmit(() => void saveSettlement())}>
        <BaseerFormSection title={language === "ar" ? "بيانات التسوية" : "Settlement details"}><BaseerFormGrid>
          <label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={settlementForm.businessDate} onChange={(businessDate) => setSettlementForm((value) => ({ ...value, businessDate }))} /></label>
          <label>{text.settlementAmount}<BaseerMoneyInput required value={settlementForm.amount} onValueChange={(amount) => setSettlementForm((value) => ({ ...value, amount, allocations: value.allocations.map((allocation, index) => index === 0 ? { ...allocation, amount } : allocation) }))} />{settlementState.formState.errors.amount ? <small role="alert">{settlementState.formState.errors.amount.message}</small> : null}</label>
          <label className="baseer-form-field--full">{text.nextSettlementDate}<BaseerDatePicker clearable language={language} label={text.nextSettlementDate} min={settlementForm.businessDate} value={settlementForm.deferRemainingUntil} onChange={(deferRemainingUntil) => setSettlementForm((value) => ({ ...value, deferRemainingUntil }))} /></label>
        </BaseerFormGrid></BaseerFormSection>
        {settlementForm.allocations.map((allocation, index) => <BaseerFormSection key={index} title={language === "ar" ? `توزيع ${index + 1}` : `Allocation ${index + 1}`}><BaseerFormGrid>
          <label>{text.selectVault}<BaseerCombobox required label={text.selectVault} value={allocation.vaultId} placeholder={text.selectVault} options={activeVaults.map((item) => ({ id: item.id, label: language === "ar" ? item.nameAr : item.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setSettlementForm((value) => ({ ...value, allocations: value.allocations.map((entry, entryIndex) => entryIndex === index ? { ...entry, vaultId, paymentMethod: vault?.paymentMethod ?? "" } : entry) })); }} /></label>
          <label>{language === "ar" ? "طريقة السداد" : "Payment method"}<BaseerCombobox searchable={false} required label={language === "ar" ? "طريقة السداد" : "Payment method"} value={allocation.paymentMethod} placeholder={language === "ar" ? "طريقة السداد" : "Payment method"} options={(activeVaults.find((item) => item.id === allocation.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => setSettlementForm((value) => ({ ...value, allocations: value.allocations.map((entry, entryIndex) => entryIndex === index ? { ...entry, paymentMethod: paymentMethod as AdvanceAllocation["paymentMethod"] } : entry) }))} /></label>
          <label className="baseer-form-field--full">{text.amount}<BaseerMoneyInput required value={allocation.amount} onValueChange={(amount) => setSettlementForm((value) => ({ ...value, allocations: value.allocations.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount } : entry) }))} /></label>
          {settlementForm.allocations.length > 1 ? <BaseerButton type="button" variant="quiet" onClick={() => setSettlementForm((value) => ({ ...value, allocations: value.allocations.filter((_, entryIndex) => entryIndex !== index) }))}>{language === "ar" ? "إزالة هذا التوزيع" : "Remove this allocation"}</BaseerButton> : null}
        </BaseerFormGrid></BaseerFormSection>)}
        <BaseerButton type="button" variant="secondary" onClick={() => setSettlementForm((value) => ({ ...value, allocations: [...value.allocations, { vaultId: activeVaults[0]?.id ?? "", amount: "", paymentMethod: activeVaults[0]?.paymentMethod ?? "" }] }))}>{language === "ar" ? "إضافة خزينة" : "Add vault"}</BaseerButton>
        <BaseerFormSection title={text.notes}><BaseerFormGrid columns="one"><label>{text.notes}<BaseerTextArea compact value={settlementForm.notes} onValueChange={(notes) => setSettlementForm((value) => ({ ...value, notes }))} /></label></BaseerFormGrid></BaseerFormSection>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={advanceReversalOpen} title={language === "ar" ? "إلغاء إصدار السلفة" : "Cancel advance issue"} language={language} busy={saving} size="compact" formId="hr-advance-reversal-form" submitLabel={language === "ar" ? "إلغاء" : "Cancel"} onClose={() => setAdvanceReversalOpen(false)}><form id="hr-advance-reversal-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={advanceReversalState.handleSubmit(() => void saveAdvanceReversal())}><BaseerFormSection title={language === "ar" ? "سبب الإلغاء" : "Cancellation reason"}><BaseerFormGrid columns="one"><BaseerDatePicker language={language} label={text.date} max={today()} value={advanceReversalForm.businessDate} onChange={(businessDate) => setAdvanceReversalForm((value) => ({ ...value, businessDate }))} /><label>{language === "ar" ? "سبب الإلغاء" : "Cancellation reason"}<BaseerTextArea compact required value={advanceReversalForm.reason} onValueChange={(reason) => setAdvanceReversalForm((value) => ({ ...value, reason }))} />{advanceReversalState.formState.errors.reason ? <small role="alert">{advanceReversalState.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deferralOpen} title={text.deferAdvance} language={language} busy={saving} size="compact" formId="hr-advance-deferral-form" submitLabel={text.save} onClose={() => setDeferralOpen(false)}><form id="hr-advance-deferral-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={deferralState.handleSubmit(() => void saveDeferral())}><BaseerFormSection title={language === "ar" ? "بيانات التأجيل" : "Deferral details"}><BaseerFormGrid><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deferralForm.businessDate} onChange={(businessDate) => setDeferralForm((value) => ({ ...value, businessDate }))} /></label><label>{text.nextSettlementDate}<BaseerDatePicker language={language} label={text.nextSettlementDate} min={deferralForm.businessDate} value={deferralForm.deferredUntil} onChange={(deferredUntil) => setDeferralForm((value) => ({ ...value, deferredUntil }))} /></label><label className="baseer-form-field--full">{text.deferralReason}<BaseerTextArea compact required value={deferralForm.reason} onValueChange={(reason) => setDeferralForm((value) => ({ ...value, reason }))} />{deferralState.formState.errors.reason ? <small role="alert">{deferralState.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionOpen} title={text.addAdministrativeDeduction} language={language} busy={saving} size="standard" formId="hr-administrative-deduction-form" submitLabel={text.save} onClose={() => setDeductionOpen(false)}><form id="hr-administrative-deduction-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={deductionState.handleSubmit(() => void saveDeduction())}><BaseerFormSection title={language === "ar" ? "بيانات الخصم" : "Deduction details"}><BaseerFormGrid><label className="baseer-form-field--full">{text.selectEmployee}<BaseerCombobox required label={text.selectEmployee} value={deductionForm.employeeId} placeholder={text.selectEmployee} options={activeEmployees.map((item) => ({ id: item.id, label: `${item.employeeNumber} · ${language === "ar" ? item.nameAr : item.nameEn ?? item.nameAr}` }))} remoteSearch={searchEmployeeOptions} scopeKey={session?.companyId ?? "signed-out"} onChange={(employeeId) => setDeductionForm((value) => ({ ...value, employeeId }))} />{deductionState.formState.errors.employeeId ? <small role="alert">{deductionState.formState.errors.employeeId.message}</small> : null}</label><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deductionForm.businessDate} onChange={(businessDate) => setDeductionForm((value) => ({ ...value, businessDate }))} /></label><label>{text.amount}<BaseerMoneyInput required value={deductionForm.amount} onValueChange={(amount) => setDeductionForm((value) => ({ ...value, amount }))} />{deductionState.formState.errors.amount ? <small role="alert">{deductionState.formState.errors.amount.message}</small> : null}</label><label className="baseer-form-field--full">{text.plannedPayrollDate}<BaseerDatePicker clearable language={language} label={text.plannedPayrollDate} min={deductionForm.businessDate} value={deductionForm.plannedPayrollDate} onChange={(plannedPayrollDate) => setDeductionForm((value) => ({ ...value, plannedPayrollDate }))} /></label><label className="baseer-form-field--full">{text.deductionDescription}<BaseerTextArea compact required value={deductionForm.description} onValueChange={(description) => setDeductionForm((value) => ({ ...value, description }))} />{deductionState.formState.errors.description ? <small role="alert">{deductionState.formState.errors.description.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionDeferralOpen} title={text.deferDeduction} language={language} busy={saving} size="compact" formId="hr-administrative-deduction-deferral-form" submitLabel={text.save} onClose={() => setDeductionDeferralOpen(false)}><form id="hr-administrative-deduction-deferral-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={deductionDeferralState.handleSubmit(() => void saveDeductionDeferral())}><BaseerFormSection title={language === "ar" ? "بيانات التأجيل" : "Deferral details"}><BaseerFormGrid><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deductionDeferralForm.businessDate} onChange={(businessDate) => setDeductionDeferralForm((value) => ({ ...value, businessDate }))} /></label><label>{text.plannedPayrollDate}<BaseerDatePicker language={language} label={text.plannedPayrollDate} min={deductionDeferralForm.businessDate} value={deductionDeferralForm.deferredUntil} onChange={(deferredUntil) => setDeductionDeferralForm((value) => ({ ...value, deferredUntil }))} /></label><label className="baseer-form-field--full">{text.deferralReason}<BaseerTextArea compact required value={deductionDeferralForm.reason} onValueChange={(reason) => setDeductionDeferralForm((value) => ({ ...value, reason }))} />{deductionDeferralState.formState.errors.reason ? <small role="alert">{deductionDeferralState.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionCancellationOpen} title={text.cancelDeduction} language={language} busy={saving} size="compact" formId="hr-administrative-deduction-cancel-form" submitLabel={text.save} onClose={() => setDeductionCancellationOpen(false)}><form id="hr-administrative-deduction-cancel-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={deductionCancellationState.handleSubmit(() => void saveDeductionCancellation())}><BaseerFormSection title={language === "ar" ? "قرار الإلغاء" : "Cancellation decision"}><BaseerFormGrid><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deductionCancellationForm.businessDate} onChange={(businessDate) => setDeductionCancellationForm((value) => ({ ...value, businessDate }))} /></label><label className="baseer-form-field--full">{text.deferralReason}<BaseerTextArea compact required value={deductionCancellationForm.reason} onValueChange={(reason) => setDeductionCancellationForm((value) => ({ ...value, reason }))} />{deductionCancellationState.formState.errors.reason ? <small role="alert">{deductionCancellationState.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
  </BaseerWorkspace>;
}

function filter<T>(rows: readonly T[], value: string, fields: (row: T) => Array<string | null | undefined>) { const term = value.trim().toLowerCase(); return term ? rows.filter((row) => fields(row).filter(Boolean).join(" ").toLowerCase().includes(term)) : rows; }
function movementLabel(text: ReturnType<typeof hrText>, value: string) { return ({ SERVICE_COST: text.serviceCost, PAYROLL_ACCRUAL: text.payrollAccrual, PAYROLL_PAYMENT: text.payrollPayment, ADVANCE_ISSUED: text.advanceIssued, ADVANCE_SETTLEMENT: text.advanceSettlement })[value as "SERVICE_COST"] ?? value; }
function deductionIsOpen(value: HrAdministrativeDeduction) { return value.status === "OPEN" || value.status === "PARTIALLY_APPLIED" || value.status === "DEFERRED"; }
function deductionStatusLabel(text: ReturnType<typeof hrText>, value: HrAdministrativeDeduction["status"]) { return ({ OPEN: text.deductionOpen, PARTIALLY_APPLIED: text.deductionPartiallyApplied, APPLIED: text.deductionApplied, DEFERRED: text.deductionDeferredStatus, CANCELLED: text.cancelled })[value]; }
function deductionActionLabel(text: ReturnType<typeof hrText>, value: HrAdministrativeDeductionDetail["actions"][number]["actionType"]) { return ({ CREATED: text.addAdministrativeDeduction, DEFERRED: text.deferDeduction, CANCELLED: text.cancelDeduction, APPLIED: text.payrollPayment, REVERSED: text.cancelled })[value]; }
