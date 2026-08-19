import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerTextArea } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerSearchSelect } from "./baseer-search-select";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerMoney } from "./baseer-money";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { BaseerEmptyState, BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { presentBaseerApiError } from "./baseer-api-error";
import { hrText } from "./hr-copy";
import { HrJobTitleSelect } from "./hr-job-titles";
import { HrEmployeeDirectoryGrid } from "./hr-employee-directory-grid";
import "./hr-employee-edit-dialog.css";
import { cancelHrEmployeeAdministrativeDeduction, createHrEmployeeAdministrativeDeduction, deferHrEmployeeAdministrativeDeduction, deferHrEmployeeAdvance, getHrAdministrativeDeduction, getHrAdvance, getHrEmployee, issueHrEmployeeAdvance, listHrAdministrativeDeductions, listHrAdvances, listHrEmployees, settleHrEmployeeAdvanceDirectly, updateHrEmployee, type HrAdministrativeDeduction, type HrAdministrativeDeductionDetail, type HrAdvance, type HrAdvanceDetail, type HrDetail, type HrEmployee, type HrEmployeeStatus } from "./hr-client";

type Language = "ar" | "en";
type EmployeeForm = { employeeNumber: string; nameAr: string; nameEn: string; jobTitle: string; phone: string; email: string; iqamaNumber: string; workSchedule: string; hireDate: string; status: HrEmployeeStatus; terminatedAt: string; notes: string };
type AdvanceAllocation = { vaultId: string; amount: string; paymentMethod: "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP" | "" };
type AdvanceForm = { employeeId: string; businessDate: string; amount: string; notes: string; vaultId: string; paymentMethod: AdvanceAllocation["paymentMethod"] };
type SettlementForm = { advanceId: string; businessDate: string; amount: string; deferRemainingUntil: string; notes: string; allocations: AdvanceAllocation[] };
type DeferralForm = { advanceId: string; businessDate: string; deferredUntil: string; reason: string };
type DeductionForm = { employeeId: string; businessDate: string; amount: string; description: string; plannedPayrollDate: string };
type DeductionDeferralForm = { deductionId: string; businessDate: string; deferredUntil: string; reason: string };
type DeductionCancellationForm = { deductionId: string; businessDate: string; reason: string };
type FinanceConfiguration = { suppliers: Array<{ id: string; nameAr: string; nameEn: string | null; status: "ACTIVE" | "ARCHIVED" }>; categories: Array<{ id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; status: "ACTIVE" | "ARCHIVED"; isPosting: boolean }>; vaults: Array<{ id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: AdvanceAllocation["paymentMethod"]; paymentMethods: Exclude<AdvanceAllocation["paymentMethod"], "">[] }> };

const today = () => new Date().toISOString().slice(0, 10);
const emptyEmployee = (): EmployeeForm => ({ employeeNumber: "", nameAr: "", nameEn: "", jobTitle: "", phone: "", email: "", iqamaNumber: "", workSchedule: "", hireDate: today(), status: "ACTIVE", terminatedAt: "", notes: "" });
const emptyAdvance = (employeeId = "", vaultId = "", paymentMethod: AdvanceAllocation["paymentMethod"] = ""): AdvanceForm => ({ employeeId, businessDate: today(), amount: "", notes: "", vaultId, paymentMethod });
const futureDate = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const emptySettlement = (advanceId = "", amount = "", vaultId = "", paymentMethod: AdvanceAllocation["paymentMethod"] = ""): SettlementForm => ({ advanceId, businessDate: today(), amount, deferRemainingUntil: "", notes: "", allocations: [{ vaultId, amount, paymentMethod }] });
const emptyDeferral = (advanceId = ""): DeferralForm => ({ advanceId, businessDate: today(), deferredUntil: futureDate(30), reason: "" });
const emptyDeduction = (): DeductionForm => ({ employeeId: "", businessDate: today(), amount: "", description: "", plannedPayrollDate: "" });
const emptyDeductionDeferral = (deductionId = ""): DeductionDeferralForm => ({ deductionId, businessDate: today(), deferredUntil: futureDate(30), reason: "" });
const emptyDeductionCancellation = (deductionId = ""): DeductionCancellationForm => ({ deductionId, businessDate: today(), reason: "" });
const HrPayrollWorkspace = lazy(() => import("./hr-payroll-workspace").then((module) => ({ default: module.HrPayrollWorkspace })));
const HrLeaveWorkspace = lazy(() => import("./hr-leave-workspace").then((module) => ({ default: module.HrLeaveWorkspace })));
const HrServicesWorkspace = lazy(() => import("./hr-services-workspace").then((module) => ({ default: module.HrServicesWorkspace })));
const HrSalaryToolsWorkspace = lazy(() => import("./hr-salary-tools-workspace").then((module) => ({ default: module.HrSalaryToolsWorkspace })));
const HrEmployeeProfileDialog = lazy(() => import("./hr-employee-profile-dialog").then((module) => ({ default: module.HrEmployeeProfileDialog })));
const HrCompensationAgreementDialog = lazy(() => import("./hr-compensation-agreement-dialog").then((module) => ({ default: module.HrCompensationAgreementDialog })));
const HrEmployeeOnboardingDialog = lazy(() => import("./hr-employee-onboarding-dialog").then((module) => ({ default: module.HrEmployeeOnboardingDialog })));
const DailySalesSignIn = lazy(() => import("./daily-sales-sign-in").then((module) => ({ default: module.DailySalesSignIn })));

export function HrWorkspace({ language, section }: { language: Language; section: number }) {
  if (section === 6) return <Suspense fallback={<BaseerCard>{language === "ar" ? "جارٍ تحميل أدوات الراتب…" : "Loading salary tools…"}</BaseerCard>}><HrSalaryToolsWorkspace language={language} /></Suspense>;
  return <HrWorkspaceCore language={language} section={section} />;
}

function HrWorkspaceCore({ language, section }: { language: Language; section: number }) {
  const text = hrText(language);
  const isAdvance = section === 4;
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [advances, setAdvances] = useState<HrAdvance[]>([]);
  const [deductions, setDeductions] = useState<HrAdministrativeDeduction[]>([]);
  const [overview, setOverview] = useState({ activeEmployees: 0, employeesOnLeave: 0, openAdvances: 0, openAdministrativeDeductions: 0 });
  const [nextEmployeeCursor, setNextEmployeeCursor] = useState<string | null>(null);
  const [nextAdvanceCursor, setNextAdvanceCursor] = useState<string | null>(null);
  const [nextDeductionCursor, setNextDeductionCursor] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<FinanceConfiguration | null>(null);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [employeeView, setEmployeeView] = useState<"cards" | "table">("cards");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const showSuccess = useCallback((text: string) => setMessage({ tone: "success", text }), []);
  const showError = useCallback((text: string) => setMessage({ tone: "danger", text }), []);
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
  const [employeeForm, setEmployeeForm] = useState<EmployeeForm>(emptyEmployee());
  const [advanceForm, setAdvanceForm] = useState<AdvanceForm>(emptyAdvance());
  const [settlementForm, setSettlementForm] = useState<SettlementForm>(emptySettlement());
  const [deferralForm, setDeferralForm] = useState<DeferralForm>(emptyDeferral());
  const [deductionForm, setDeductionForm] = useState<DeductionForm>(emptyDeduction());
  const [deductionDeferralForm, setDeductionDeferralForm] = useState<DeductionDeferralForm>(emptyDeductionDeferral());
  const [deductionCancellationForm, setDeductionCancellationForm] = useState<DeductionCancellationForm>(emptyDeductionCancellation());

  const load = useCallback(async (): Promise<boolean> => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return false; }
    setLoading(true);
    try {
      // The employee register must remain available even when an unrelated
      // advances/discounts request has a finance configuration problem.
      const employeeReceipt = await listHrEmployees(current);
      setEmployees(employeeReceipt.employees); setOverview(employeeReceipt.summary); setNextEmployeeCursor(employeeReceipt.nextCursor);
      if (isAdvance) {
        const [advanceReceipt, deductionReceipt] = await Promise.all([listHrAdvances(current, { employeeId: employeeFilter || undefined }), listHrAdministrativeDeductions(current, { employeeId: employeeFilter || undefined })]);
        setAdvances(advanceReceipt.advances); setDeductions(deductionReceipt.deductions); setNextAdvanceCursor(advanceReceipt.nextCursor); setNextDeductionCursor(deductionReceipt.nextCursor);
      }
      return true;
    }
    catch (error) { showError(presentBaseerApiError(error, language, text.loading)); return false; }
    finally { setLoading(false); }
  }, [employeeFilter, isAdvance, language, text.loading]);
  useEffect(() => { void load(); }, [load]);
  const loadConfiguration = useCallback(async () => { const current = activeSession(); if (!current) return null; const next = await api<FinanceConfiguration>(current, "/finance/configuration"); setConfiguration(next); return next; }, []);
  const searchEmployeeOptions = useCallback(async (query: string) => {
    const current = activeSession(); if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 });
    return receipt.employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE").map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}` }));
  }, [language]);
  const refreshDetail = async (employeeId: string) => { const current = activeSession(); if (current) setDetail(await getHrEmployee(current, employeeId)); };
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
        const receipt = await listHrEmployees(current, { cursor: nextEmployeeCursor });
        setEmployees((rows) => [...rows, ...receipt.employees]); setNextEmployeeCursor(receipt.nextCursor);
      } else if (kind === "advances" && nextAdvanceCursor) {
        const receipt = await listHrAdvances(current, { employeeId: employeeFilter || undefined, cursor: nextAdvanceCursor });
        setAdvances((rows) => [...rows, ...receipt.advances]); setNextAdvanceCursor(receipt.nextCursor);
      } else if (kind === "deductions" && nextDeductionCursor) {
        const receipt = await listHrAdministrativeDeductions(current, { employeeId: employeeFilter || undefined, cursor: nextDeductionCursor });
        setDeductions((rows) => [...rows, ...receipt.deductions]); setNextDeductionCursor(receipt.nextCursor);
      }
    } catch (error) {
      showError(presentBaseerApiError(error, language, text.loadMore));
    }
  };
  const showDetail = async (employee: HrEmployee) => { try { await refreshDetail(employee.id); } catch (error) { showError(presentBaseerApiError(error, language, text.employeeFile)); } };
  const showAdvanceDetail = async (advance: HrAdvance) => { const current = activeSession(); if (!current) return; try { setAdvanceDetail(await getHrAdvance(current, advance.id)); } catch (error) { showError(presentBaseerApiError(error, language, text.advances)); } };
  const showDeductionDetail = async (deduction: HrAdministrativeDeduction) => { const current = activeSession(); if (!current) return; try { setDeductionDetail(await getHrAdministrativeDeduction(current, deduction.id)); } catch (error) { showError(presentBaseerApiError(error, language, text.administrativeDeductions)); } };
  const openEmployeeEdit = (employee: HrEmployee) => { setEditingEmployeeId(employee.id); setAdditionalEmployeeInfoOpen(false); setEmployeeForm({ employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn ?? "", jobTitle: employee.jobTitle ?? "", phone: employee.phone ?? "", email: employee.email ?? "", iqamaNumber: employee.iqamaNumber ?? "", workSchedule: employee.workSchedule ?? "", hireDate: employee.hireDate, status: employee.status, terminatedAt: employee.terminatedAt ?? "", notes: employee.notes ?? "" }); setEmployeeOpen(true); };
  const saveEmployee = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving || !editingEmployeeId) return; setSaving(true); try { await updateHrEmployee(current, { employeeId: editingEmployeeId, nameAr: employeeForm.nameAr, nameEn: employeeForm.nameEn || null, jobTitle: employeeForm.jobTitle || null, phone: employeeForm.phone || null, email: employeeForm.email || null, iqamaNumber: employeeForm.iqamaNumber || null, workSchedule: employeeForm.workSchedule || null, status: employeeForm.status, terminatedAt: employeeForm.status === "TERMINATED" ? employeeForm.terminatedAt : null, notes: employeeForm.notes || null, idempotencyKey: requestId() }); const updatedId = editingEmployeeId; setEmployeeOpen(false); setEditingEmployeeId(null); setEmployeeForm(emptyEmployee()); showSuccess(text.employeeUpdated); await load(); if (detail?.employee.id === updatedId) await refreshDetail(updatedId); } catch (error) { showError(presentBaseerApiError(error, language, text.employeeUpdated)); } finally { setSaving(false); } };
  const openAdvance = async () => { try { const next = configuration ?? await loadConfiguration(); const firstVault = next?.vaults.find((item) => item.status === "ACTIVE" && item.isPaymentDestination); setAdvanceForm(emptyAdvance("", firstVault?.id ?? "", firstVault?.paymentMethod ?? "")); setAdvanceOpen(true); } catch (error) { showError(presentBaseerApiError(error, language, text.addAdvance)); } };
  const saveAdvance = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await issueHrEmployeeAdvance(current, { employeeId: advanceForm.employeeId, businessDate: advanceForm.businessDate, amount: advanceForm.amount, notes: advanceForm.notes || undefined, allocations: [{ vaultId: advanceForm.vaultId, amount: advanceForm.amount, paymentMethod: advanceForm.paymentMethod || undefined }], idempotencyKey: requestId() }); setAdvanceOpen(false); showSuccess(text.advanceSaved); await load(); if (detail?.employee.id === advanceForm.employeeId) await refreshDetail(advanceForm.employeeId); } catch (error) { showError(presentBaseerApiError(error, language, text.addAdvance)); } finally { setSaving(false); } };
  const openSettlement = async (advance: HrAdvance) => { try { const next = configuration ?? await loadConfiguration(); const firstVault = next?.vaults.find((item) => item.status === "ACTIVE" && item.isPaymentDestination); setSettlementForm(emptySettlement(advance.id, advance.remainingAmount, firstVault?.id ?? "", firstVault?.paymentMethod ?? "")); setSettlementOpen(true); } catch (error) { showError(presentBaseerApiError(error, language, text.settleAdvance)); } };
  const saveSettlement = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await settleHrEmployeeAdvanceDirectly(current, { advanceId: settlementForm.advanceId, businessDate: settlementForm.businessDate, amount: settlementForm.amount, deferRemainingUntil: settlementForm.deferRemainingUntil || undefined, notes: settlementForm.notes || undefined, allocations: settlementForm.allocations.map((item) => ({ vaultId: item.vaultId, amount: item.amount, paymentMethod: item.paymentMethod || undefined })), idempotencyKey: requestId() }); setSettlementOpen(false); showSuccess(text.settlementSaved); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.settleAdvance)); } finally { setSaving(false); } };
  const openDeferral = (advance: HrAdvance) => { setDeferralForm({ ...emptyDeferral(advance.id), deferredUntil: advance.nextSettlementDate ?? futureDate(30) }); setDeferralOpen(true); };
  const saveDeferral = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await deferHrEmployeeAdvance(current, { ...deferralForm, idempotencyKey: requestId() }); setDeferralOpen(false); showSuccess(text.deferralSaved); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.deferAdvance)); } finally { setSaving(false); } };
  const saveDeduction = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await createHrEmployeeAdministrativeDeduction(current, { ...deductionForm, plannedPayrollDate: deductionForm.plannedPayrollDate || undefined, idempotencyKey: requestId() }); setDeductionOpen(false); setDeductionForm(emptyDeduction()); showSuccess(text.deductionSaved); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.addAdministrativeDeduction)); } finally { setSaving(false); } };
  const openDeductionDeferral = (deduction: HrAdministrativeDeduction) => { setDeductionDeferralForm({ ...emptyDeductionDeferral(deduction.id), deferredUntil: deduction.plannedPayrollDate ?? futureDate(30) }); setDeductionDeferralOpen(true); };
  const saveDeductionDeferral = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await deferHrEmployeeAdministrativeDeduction(current, { ...deductionDeferralForm, idempotencyKey: requestId() }); setDeductionDeferralOpen(false); showSuccess(text.deductionDeferred); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.deferDeduction)); } finally { setSaving(false); } };
  const openDeductionCancellation = (deduction: HrAdministrativeDeduction) => { setDeductionCancellationForm(emptyDeductionCancellation(deduction.id)); setDeductionCancellationOpen(true); };
  const saveDeductionCancellation = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; setSaving(true); try { await cancelHrEmployeeAdministrativeDeduction(current, { ...deductionCancellationForm, idempotencyKey: requestId() }); setDeductionCancellationOpen(false); showSuccess(text.deductionCancelled); await load(); } catch (error) { showError(presentBaseerApiError(error, language, text.cancelDeduction)); } finally { setSaving(false); } };

  const visibleEmployees = useMemo(() => filter(employees, search, (item) => [item.employeeNumber, item.nameAr, item.nameEn, item.jobTitle]), [employees, search]);
  const visibleAdvances = useMemo(() => filter(advances.filter((item) => !employeeFilter || item.employeeId === employeeFilter), search, (item) => [item.advanceNumber, item.employeeNameAr, item.employeeNameEn, item.notes]), [advances, employeeFilter, search]);
  const visibleDeductions = useMemo(() => filter(deductions.filter((item) => !employeeFilter || item.employeeId === employeeFilter), search, (item) => [item.deductionNumber, item.employeeNameAr, item.employeeNameEn, item.description, item.status]), [deductions, employeeFilter, search]);
  const statusLabel = (status: HrEmployeeStatus) => ({ ACTIVE: text.active, ON_LEAVE: text.onLeave, TERMINATED: text.terminated, ARCHIVED: text.archived })[status];
  const sectionTitle = [text.overview, text.employees, language === "ar" ? "الإجازات والعودة" : "Leave & return", language === "ar" ? "الرواتب" : "Payroll", language === "ar" ? "السلف والخصومات" : "Advances & deductions", text.services][section] ?? text.title;
  const employeeColumns: readonly DataTableColumn<HrEmployee>[] = [
    { id: "number", header: text.employeeNumber, cell: (row) => row.employeeNumber, width: "9rem", sort: (row) => row.employeeNumber },
    { id: "name", header: text.employeeName, cell: (row) => <button type="button" className="baseer-link-button" onClick={() => void showDetail(row)}>{language === "ar" ? row.nameAr : row.nameEn ?? row.nameAr}</button>, sort: (row) => language === "ar" ? row.nameAr : row.nameEn ?? row.nameAr },
    { id: "job", header: text.jobTitle, cell: (row) => row.jobTitle ?? "—", sort: (row) => row.jobTitle },
    { id: "hire", header: text.hireDate, cell: (row) => row.hireDate, width: "9rem", sort: (row) => row.hireDate },
    { id: "salary", header: text.monthlySalary, cell: (row) => row.currentMonthlyGross ? <BaseerMoney value={row.currentMonthlyGross} language={language} /> : "—", align: "end", numeric: true, width: "10rem", sort: (row) => row.currentMonthlyGross ?? "" },
    { id: "status", header: text.status, cell: (row) => <BaseerStatusBadge tone={row.status === "ACTIVE" ? "success" : row.status === "ON_LEAVE" ? "warning" : "neutral"}>{statusLabel(row.status)}</BaseerStatusBadge>, width: "8rem", sort: (row) => row.status },
  ];
  const advanceColumns: readonly DataTableColumn<HrAdvance>[] = [
    { id: "number", header: text.advanceNumber, cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => void showAdvanceDetail(row)}>{row.advanceNumber}</BaseerButton>, width: "13rem", sort: (row) => row.advanceNumber },
    { id: "employee", header: text.employeeName, cell: (row) => language === "ar" ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr, sort: (row) => language === "ar" ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr },
    { id: "date", header: text.date, cell: (row) => row.businessDate, width: "9rem", sort: (row) => row.businessDate },
    { id: "original", header: text.originalAmount, cell: (row) => <BaseerMoney value={row.originalAmount} language={language} />, align: "end", numeric: true, width: "9rem", sort: (row) => row.originalAmount },
    { id: "remaining", header: text.remainingAmount, cell: (row) => <BaseerMoney value={row.remainingAmount} language={language} />, align: "end", numeric: true, width: "10rem", sort: (row) => row.remainingAmount },
    { id: "next", header: text.nextSettlementDate, cell: (row) => row.nextSettlementDate ?? "—", width: "11rem", sort: (row) => row.nextSettlementDate },
    { id: "settle", header: text.settleAdvance, cell: (row) => row.remainingAmount !== "0.0000" ? <BaseerButton type="button" variant="secondary" onClick={() => void openSettlement(row)}>{text.settleAdvance}</BaseerButton> : "—", width: "11rem" },
    { id: "defer", header: text.deferAdvance, cell: (row) => row.remainingAmount !== "0.0000" ? <BaseerButton type="button" variant="quiet" onClick={() => openDeferral(row)}>{text.deferAdvance}</BaseerButton> : "—", width: "11rem" },
  ];
  const deductionColumns: readonly DataTableColumn<HrAdministrativeDeduction>[] = [
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
  const createEmployeeAction = <BaseerButton type="button" onClick={() => setOnboardingOpen(true)}>{text.addEmployee}</BaseerButton>;

  if (!session) return <Suspense fallback={<BaseerCard>{text.loading}</BaseerCard>}><DailySalesSignIn language={language} /></Suspense>;
  if (section === 3) return <Suspense fallback={<BaseerCard>{language === "ar" ? "جارٍ تحميل مسير الرواتب…" : "Loading payroll…"}</BaseerCard>}><HrPayrollWorkspace language={language} /></Suspense>;
  if (section === 2) return <Suspense fallback={<BaseerCard>{language === "ar" ? "جارٍ تحميل الإجازات والعودة…" : "Loading leave & return…"}</BaseerCard>}><HrLeaveWorkspace language={language} /></Suspense>;
  if (section === 5) return <Suspense fallback={<BaseerCard>{language === "ar" ? "جارٍ تحميل خدمات الموظفين…" : "Loading employee services…"}</BaseerCard>}><HrServicesWorkspace language={language} /></Suspense>;
  return <BaseerWorkspace aria-label={text.title}>
    <BaseerSectionHeader eyebrow={section === 0 ? (language === "ar" ? "مركز عمل الموارد البشرية" : "HR operations hub") : undefined} title={sectionTitle} description={section === 0 ? (language === "ar" ? "صورة تشغيلية سريعة للموظفين والاستحقاقات المفتوحة قبل الانتقال إلى السجل المناسب." : "A focused operational snapshot before moving into the relevant register.") : undefined} actions={section === 1 ? <BaseerButton type="button" variant="primary" onClick={() => setOnboardingOpen(true)}>{text.addEmployee}</BaseerButton> : isAdvance ? <><BaseerButton type="button" variant="primary" onClick={() => void openAdvance()}>{text.addAdvance}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={() => { setDeductionForm(emptyDeduction()); setDeductionOpen(true); }}>{text.addAdministrativeDeduction}</BaseerButton></> : undefined} />
    {message ? <BaseerNotice tone={message.tone}>{message.text}</BaseerNotice> : null}
    {section === 0 ? (
      <>
        <BaseerSummaryMetricGrid><BaseerSummaryMetric label={text.active} value={String(overview.activeEmployees)} /><BaseerSummaryMetric label={text.onLeave} value={String(overview.employeesOnLeave)} /><BaseerSummaryMetric label={text.advances} value={String(overview.openAdvances)} /><BaseerSummaryMetric label={text.administrativeDeductions} value={String(overview.openAdministrativeDeductions)} /></BaseerSummaryMetricGrid>
        <BaseerNotice title={language === "ar" ? "مبدأ العمل" : "Operating principle"}>{language === "ar" ? "ملف الموظف هو نقطة الانطلاق: منه تُدار بياناته وراتبه ووثائقه وحركاته، بينما تبقى السلف والخصومات مسارات مستقلة وموثقة." : "The employee file is the operational starting point for identity, salary, documents, and movements. Advances and deductions remain separate, governed records."}</BaseerNotice>
      </>
    ) : (
      <>
        <BaseerFilterBar language={language} search={search} searchLabel={sectionTitle} searchPlaceholder={sectionTitle} onSearchChange={setSearch} controls={isAdvance ? <BaseerSearchSelect label={text.selectEmployee} value={employeeFilter} placeholder={text.selectEmployee} options={activeEmployees.map((item) => ({ id: item.id, label: `${item.employeeNumber} · ${language === "ar" ? item.nameAr : (item.nameEn ?? item.nameAr)}` }))} remoteSearch={searchEmployeeOptions} onChange={setEmployeeFilter} /> : undefined} appliedFilters={[...(search ? [{ id: "q", label: search, onRemove: () => setSearch("") }] : []), ...(employeeFilter ? [{ id: "employee", label: activeEmployees.find((item) => item.id === employeeFilter)?.nameAr ?? employeeFilter, onRemove: () => setEmployeeFilter("") }] : [])]} onClear={() => { setSearch(""); setEmployeeFilter(""); }} />
        {loading ? <BaseerCard><p>{text.loading}</p></BaseerCard> : isAdvance ? (
          <>
            <BaseerNotice tone="info">{text.advancePolicy}<br />{text.advancePending}</BaseerNotice>
            {visibleAdvances.length ? <DataTable ariaLabel={text.advances} caption={text.advances} columns={advanceColumns} rows={visibleAdvances} rowKey={(row) => row.id} /> : <BaseerEmptyState title={language === "ar" ? "لا توجد سلف مسجلة" : "No advances recorded"} />}
            {visibleDeductions.length ? <DataTable ariaLabel={text.administrativeDeductions} caption={text.administrativeDeductions} columns={deductionColumns} rows={visibleDeductions} rowKey={(row) => row.id} /> : <BaseerEmptyState title={language === "ar" ? "لا توجد خصومات إدارية" : "No administrative deductions"} />}
          </>
        ) : visibleEmployees.length ? <><div className="hr-employee-view-switch" role="group" aria-label={language === "ar" ? "طريقة عرض الموظفين" : "Employee display mode"}><BaseerButton type="button" variant={employeeView === "cards" ? "primary" : "secondary"} onClick={() => setEmployeeView("cards")}>{language === "ar" ? "بطاقات" : "Cards"}</BaseerButton><BaseerButton type="button" variant={employeeView === "table" ? "primary" : "secondary"} onClick={() => setEmployeeView("table")}>{language === "ar" ? "جدول" : "Table"}</BaseerButton></div>{employeeView === "cards" ? <HrEmployeeDirectoryGrid employees={visibleEmployees} language={language} onOpen={(employee) => void showDetail(employee)} /> : <DataTable ariaLabel={sectionTitle} caption={sectionTitle} columns={employeeColumns} rows={visibleEmployees} rowKey={(row) => row.id} />}</> : <BaseerEmptyState title={text.noEmployees} action={createEmployeeAction} />}
      </>
    )}
    {!loading && section === 1 && nextEmployeeCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void loadMoreRegister("employees")}>{text.loadMore}</BaseerButton> : null}
    {!loading && isAdvance && (nextAdvanceCursor || nextDeductionCursor) ? <BaseerButton type="button" variant="secondary" onClick={() => { if (nextAdvanceCursor) void loadMoreRegister("advances"); if (nextDeductionCursor) void loadMoreRegister("deductions"); }}>{text.loadMore}</BaseerButton> : null}

    {onboardingOpen ? <Suspense fallback={null}><HrEmployeeOnboardingDialog open language={language} onClose={() => setOnboardingOpen(false)} onSaved={async () => { const refreshed = await load(); if (refreshed) showSuccess(text.employeeSaved); return refreshed; }} onError={showError} /></Suspense> : null}
    <BaseerFormDialog open={employeeOpen} title={text.editEmployee} language={language} busy={saving} size="standard" className="hr-employee-edit-dialog" formId="hr-employee-form" submitLabel={text.save} onClose={() => { setEmployeeOpen(false); setEditingEmployeeId(null); setAdditionalEmployeeInfoOpen(false); }}>
      <form id="hr-employee-form" className="baseer-form hr-employee-edit" onSubmit={(event) => void saveEmployee(event)}>
        <div className="hr-employee-edit__meta"><span><small>{text.employeeNumber}</small><bdi>{employeeForm.employeeNumber}</bdi></span><span><small>{text.hireDate}</small><bdi>{employeeForm.hireDate}</bdi></span></div>
        <BaseerFormGrid className="hr-employee-edit__core">
          <label className="baseer-form-field">{text.employeeName}<input required autoFocus value={employeeForm.nameAr} onChange={(event) => setEmployeeForm((value) => ({ ...value, nameAr: event.target.value }))} /></label>
          <label className="baseer-form-field">{text.jobTitle}<HrJobTitleSelect id="hr-edit-job-titles" language={language} value={employeeForm.jobTitle} onChange={(jobTitle) => setEmployeeForm((value) => ({ ...value, jobTitle }))} /></label>
          <label className="baseer-form-field">{text.status}<BaseerSearchSelect searchable={false} required label={text.status} value={employeeForm.status} placeholder={text.status} options={(["ACTIVE", "ON_LEAVE", "TERMINATED", "ARCHIVED"] as const).map((status) => ({ id: status, label: statusLabel(status) }))} onChange={(status) => setEmployeeForm((value) => ({ ...value, status: status as HrEmployeeStatus, terminatedAt: status === "TERMINATED" ? value.terminatedAt : "" }))} /></label>
          {employeeForm.status === "TERMINATED" ? <label className="baseer-form-field">{text.terminationDate}<input required type="date" min={employeeForm.hireDate} max={today()} value={employeeForm.terminatedAt} onChange={(event) => setEmployeeForm((value) => ({ ...value, terminatedAt: event.target.value }))} /></label> : null}
        </BaseerFormGrid>
        <BaseerButton type="button" variant="quiet" className="hr-employee-edit__additional-toggle" aria-expanded={additionalEmployeeInfoOpen} onClick={() => setAdditionalEmployeeInfoOpen((value) => !value)}><span>{language === "ar" ? "معلومات إضافية" : "Additional information"}</span><b aria-hidden="true">{additionalEmployeeInfoOpen ? "−" : "+"}</b></BaseerButton>
        {additionalEmployeeInfoOpen ? <BaseerFormGrid className="hr-employee-edit__additional-fields"><label className="baseer-form-field">{text.englishName}<input dir="ltr" value={employeeForm.nameEn} onChange={(event) => setEmployeeForm((value) => ({ ...value, nameEn: event.target.value }))} /></label><label className="baseer-form-field">{language === "ar" ? "رقم الإقامة" : "Iqama number"}<input inputMode="numeric" value={employeeForm.iqamaNumber} onChange={(event) => setEmployeeForm((value) => ({ ...value, iqamaNumber: event.target.value }))} /></label><label className="baseer-form-field">{text.phone}<input dir="ltr" inputMode="tel" value={employeeForm.phone} onChange={(event) => setEmployeeForm((value) => ({ ...value, phone: event.target.value }))} /></label><label className="baseer-form-field">{text.email}<input dir="ltr" type="email" value={employeeForm.email} onChange={(event) => setEmployeeForm((value) => ({ ...value, email: event.target.value }))} /></label></BaseerFormGrid> : null}
        <BaseerFormGrid columns="one"><label className="baseer-form-field hr-employee-edit__notes">{text.notes}<textarea rows={1} value={employeeForm.notes} onChange={(event) => setEmployeeForm((value) => ({ ...value, notes: event.target.value }))} /></label></BaseerFormGrid>
      </form>
    </BaseerFormDialog>
    {detail ? <Suspense fallback={null}><HrEmployeeProfileDialog detail={detail} language={language} onClose={() => setDetail(null)} onEdit={() => { openEmployeeEdit(detail.employee); setDetail(null); }} onManageCompensation={() => { setCompensationTarget({ employee: detail.employee, profile: detail.compensation }); setDetail(null); }} onLoadMoreMovements={loadMoreMovements} onError={showError} onChanged={async () => { await load(); await refreshDetail(detail.employee.id); }} /></Suspense> : null}
    {compensationTarget ? <Suspense fallback={null}><HrCompensationAgreementDialog open language={language} employees={employees} fixedEmployeeId={compensationTarget.employee.id} profile={compensationTarget.profile} onClose={() => setCompensationTarget(null)} onSaved={async () => { await load(); showSuccess(language === "ar" ? "تم حفظ الراتب؛ سيطبق من شهر التعديل دون تغيير المسيرات السابقة." : "Salary saved; it applies from the change month without altering past payroll."); }} onError={showError} /></Suspense> : null}
    <BaseerDialog open={advanceDetail !== null} title={advanceDetail?.advance.advanceNumber ?? text.advances} language={language} onClose={() => setAdvanceDetail(null)} footer={<BaseerButton type="button" variant="secondary" onClick={() => setAdvanceDetail(null)}>{text.cancel}</BaseerButton>}>{advanceDetail ? <div className="administration-list"><article><strong>{language === "ar" ? advanceDetail.advance.employeeNameAr : advanceDetail.advance.employeeNameEn ?? advanceDetail.advance.employeeNameAr}</strong><span>{text.originalAmount}: {advanceDetail.advance.originalAmount}</span><span>{text.remainingAmount}: {advanceDetail.advance.remainingAmount}</span><span>{text.status}: {advanceDetail.advance.status}</span></article><article><strong>{text.settleAdvance}</strong>{advanceDetail.settlements.length ? advanceDetail.settlements.map((item) => <span key={item.id}>{item.businessDate} · {item.amount} · {item.source === "PAYROLL" ? text.payrollPayment : text.settleAdvance} · {item.sourceReference ?? "—"}</span>) : <span>—</span>}</article><article><strong>{text.deferAdvance}</strong>{advanceDetail.deferrals.length ? advanceDetail.deferrals.map((item) => <span key={item.id}>{item.businessDate} · {item.deferredUntil} · {item.reason}</span>) : <span>—</span>}</article></div> : null}</BaseerDialog>
    <BaseerDialog open={deductionDetail !== null} title={deductionDetail?.deduction.deductionNumber ?? text.administrativeDeductions} language={language} onClose={() => setDeductionDetail(null)} footer={<BaseerButton type="button" variant="secondary" onClick={() => setDeductionDetail(null)}>{text.cancel}</BaseerButton>}>{deductionDetail ? <div className="administration-list"><article><strong>{language === "ar" ? deductionDetail.deduction.employeeNameAr : deductionDetail.deduction.employeeNameEn ?? deductionDetail.deduction.employeeNameAr}</strong><span>{text.deductionDescription}: {deductionDetail.deduction.description}</span><span>{text.originalAmount}: {deductionDetail.deduction.originalAmount}</span><span>{text.remainingAmount}: {deductionDetail.deduction.remainingAmount}</span></article><article><strong>{text.financialRecord}</strong>{deductionDetail.actions.length ? deductionDetail.actions.map((item) => <span key={item.id}>{item.businessDate} · {deductionActionLabel(text, item.actionType)} · {item.amount ?? "—"} · {item.plannedPayrollDate ?? item.reason ?? "—"}</span>) : <span>—</span>}</article></div> : null}</BaseerDialog>
    <BaseerFormDialog open={advanceOpen} title={text.addAdvance} language={language} busy={saving} size="standard" formId="hr-advance-form" submitLabel={text.save} onClose={() => setAdvanceOpen(false)}>
      <form id="hr-advance-form" className="baseer-form" onSubmit={(event) => void saveAdvance(event)}>
        <BaseerFormSection title={language === "ar" ? "بيانات السلفة" : "Advance details"} description={language === "ar" ? "اختر الموظف والمبلغ وتاريخ الإصدار." : "Choose the employee, amount, and issue date."}>
          <BaseerFormGrid>
            <label className="baseer-form-field baseer-form-field--full">{text.selectEmployee}<BaseerSearchSelect required label={text.selectEmployee} value={advanceForm.employeeId} placeholder={text.selectEmployee} options={activeEmployees.map((item) => ({ id: item.id, label: `${item.employeeNumber} · ${language === "ar" ? item.nameAr : item.nameEn ?? item.nameAr}` }))} onChange={(employeeId) => setAdvanceForm((value) => ({ ...value, employeeId }))} /></label>
            <label className="baseer-form-field">{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={advanceForm.businessDate} onChange={(businessDate) => setAdvanceForm((value) => ({ ...value, businessDate }))} /></label>
            <label className="baseer-form-field">{text.originalAmount}<BaseerMoneyInput required value={advanceForm.amount} onValueChange={(amount) => setAdvanceForm((value) => ({ ...value, amount }))} /></label>
          </BaseerFormGrid>
        </BaseerFormSection>
        <BaseerFormSection title={language === "ar" ? "مصدر الصرف" : "Payment source"} description={language === "ar" ? "تُصرف السلفة كاملة من خزينة واحدة فقط." : "The full advance is issued from one vault."}>
          <BaseerFormGrid>
            <label className="baseer-form-field">{text.selectVault}<BaseerSearchSelect required label={text.selectVault} value={advanceForm.vaultId} placeholder={text.selectVault} options={activeVaults.map((item) => ({ id: item.id, label: language === "ar" ? item.nameAr : item.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setAdvanceForm((value) => ({ ...value, vaultId, paymentMethod: vault?.paymentMethod ?? "" })); }} /></label>
            <label className="baseer-form-field">{language === "ar" ? "طريقة السداد" : "Payment method"}<BaseerSearchSelect searchable={false} required label={language === "ar" ? "طريقة السداد" : "Payment method"} value={advanceForm.paymentMethod} placeholder={language === "ar" ? "طريقة السداد" : "Payment method"} options={(activeVaults.find((item) => item.id === advanceForm.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => setAdvanceForm((value) => ({ ...value, paymentMethod: paymentMethod as AdvanceAllocation["paymentMethod"] }))} /></label>
            <label className="baseer-form-field baseer-form-field--full">{text.notes}<BaseerTextArea compact value={advanceForm.notes} onValueChange={(notes) => setAdvanceForm((value) => ({ ...value, notes }))} /></label>
          </BaseerFormGrid>
        </BaseerFormSection>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={settlementOpen} title={text.settleAdvance} language={language} busy={saving} size="standard" formId="hr-advance-settlement-form" submitLabel={text.save} onClose={() => setSettlementOpen(false)}>
      <form id="hr-advance-settlement-form" className="baseer-form" onSubmit={(event) => void saveSettlement(event)}>
        <BaseerFormSection title={language === "ar" ? "بيانات التسوية" : "Settlement details"}><BaseerFormGrid>
          <label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={settlementForm.businessDate} onChange={(businessDate) => setSettlementForm((value) => ({ ...value, businessDate }))} /></label>
          <label>{text.settlementAmount}<BaseerMoneyInput required value={settlementForm.amount} onValueChange={(amount) => setSettlementForm((value) => ({ ...value, amount, allocations: value.allocations.map((allocation, index) => index === 0 ? { ...allocation, amount } : allocation) }))} /></label>
          <label className="baseer-form-field--full">{text.nextSettlementDate}<BaseerDatePicker clearable language={language} label={text.nextSettlementDate} min={settlementForm.businessDate} value={settlementForm.deferRemainingUntil} onChange={(deferRemainingUntil) => setSettlementForm((value) => ({ ...value, deferRemainingUntil }))} /></label>
        </BaseerFormGrid></BaseerFormSection>
        {settlementForm.allocations.map((allocation, index) => <BaseerFormSection key={index} title={language === "ar" ? `توزيع ${index + 1}` : `Allocation ${index + 1}`}><BaseerFormGrid>
          <label>{text.selectVault}<BaseerSearchSelect required label={text.selectVault} value={allocation.vaultId} placeholder={text.selectVault} options={activeVaults.map((item) => ({ id: item.id, label: language === "ar" ? item.nameAr : item.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setSettlementForm((value) => ({ ...value, allocations: value.allocations.map((entry, entryIndex) => entryIndex === index ? { ...entry, vaultId, paymentMethod: vault?.paymentMethod ?? "" } : entry) })); }} /></label>
          <label>{language === "ar" ? "طريقة السداد" : "Payment method"}<BaseerSearchSelect searchable={false} required label={language === "ar" ? "طريقة السداد" : "Payment method"} value={allocation.paymentMethod} placeholder={language === "ar" ? "طريقة السداد" : "Payment method"} options={(activeVaults.find((item) => item.id === allocation.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => setSettlementForm((value) => ({ ...value, allocations: value.allocations.map((entry, entryIndex) => entryIndex === index ? { ...entry, paymentMethod: paymentMethod as AdvanceAllocation["paymentMethod"] } : entry) }))} /></label>
          <label className="baseer-form-field--full">{text.amount}<BaseerMoneyInput required value={allocation.amount} onValueChange={(amount) => setSettlementForm((value) => ({ ...value, allocations: value.allocations.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount } : entry) }))} /></label>
          {settlementForm.allocations.length > 1 ? <BaseerButton type="button" variant="quiet" onClick={() => setSettlementForm((value) => ({ ...value, allocations: value.allocations.filter((_, entryIndex) => entryIndex !== index) }))}>{language === "ar" ? "إزالة هذا التوزيع" : "Remove this allocation"}</BaseerButton> : null}
        </BaseerFormGrid></BaseerFormSection>)}
        <BaseerButton type="button" variant="secondary" onClick={() => setSettlementForm((value) => ({ ...value, allocations: [...value.allocations, { vaultId: activeVaults[0]?.id ?? "", amount: "", paymentMethod: activeVaults[0]?.paymentMethod ?? "" }] }))}>{language === "ar" ? "إضافة خزينة" : "Add vault"}</BaseerButton>
        <BaseerFormSection title={text.notes}><BaseerFormGrid columns="one"><label>{text.notes}<BaseerTextArea compact value={settlementForm.notes} onValueChange={(notes) => setSettlementForm((value) => ({ ...value, notes }))} /></label></BaseerFormGrid></BaseerFormSection>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={deferralOpen} title={text.deferAdvance} language={language} busy={saving} size="compact" formId="hr-advance-deferral-form" submitLabel={text.save} onClose={() => setDeferralOpen(false)}><form id="hr-advance-deferral-form" className="baseer-form" onSubmit={(event) => void saveDeferral(event)}><BaseerFormSection title={language === "ar" ? "بيانات التأجيل" : "Deferral details"}><BaseerFormGrid><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deferralForm.businessDate} onChange={(businessDate) => setDeferralForm((value) => ({ ...value, businessDate }))} /></label><label>{text.nextSettlementDate}<BaseerDatePicker language={language} label={text.nextSettlementDate} min={deferralForm.businessDate} value={deferralForm.deferredUntil} onChange={(deferredUntil) => setDeferralForm((value) => ({ ...value, deferredUntil }))} /></label><label className="baseer-form-field--full">{text.deferralReason}<BaseerTextArea compact required value={deferralForm.reason} onValueChange={(reason) => setDeferralForm((value) => ({ ...value, reason }))} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionOpen} title={text.addAdministrativeDeduction} language={language} busy={saving} size="standard" formId="hr-administrative-deduction-form" submitLabel={text.save} onClose={() => setDeductionOpen(false)}><form id="hr-administrative-deduction-form" className="baseer-form" onSubmit={(event) => void saveDeduction(event)}><BaseerFormSection title={language === "ar" ? "بيانات الخصم" : "Deduction details"}><BaseerFormGrid><label className="baseer-form-field--full">{text.selectEmployee}<BaseerSearchSelect required label={text.selectEmployee} value={deductionForm.employeeId} placeholder={text.selectEmployee} options={activeEmployees.map((item) => ({ id: item.id, label: `${item.employeeNumber} · ${language === "ar" ? item.nameAr : item.nameEn ?? item.nameAr}` }))} onChange={(employeeId) => setDeductionForm((value) => ({ ...value, employeeId }))} /></label><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deductionForm.businessDate} onChange={(businessDate) => setDeductionForm((value) => ({ ...value, businessDate }))} /></label><label>{text.amount}<BaseerMoneyInput required value={deductionForm.amount} onValueChange={(amount) => setDeductionForm((value) => ({ ...value, amount }))} /></label><label className="baseer-form-field--full">{text.plannedPayrollDate}<BaseerDatePicker clearable language={language} label={text.plannedPayrollDate} min={deductionForm.businessDate} value={deductionForm.plannedPayrollDate} onChange={(plannedPayrollDate) => setDeductionForm((value) => ({ ...value, plannedPayrollDate }))} /></label><label className="baseer-form-field--full">{text.deductionDescription}<BaseerTextArea compact required value={deductionForm.description} onValueChange={(description) => setDeductionForm((value) => ({ ...value, description }))} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionDeferralOpen} title={text.deferDeduction} language={language} busy={saving} size="compact" formId="hr-administrative-deduction-deferral-form" submitLabel={text.save} onClose={() => setDeductionDeferralOpen(false)}><form id="hr-administrative-deduction-deferral-form" className="baseer-form" onSubmit={(event) => void saveDeductionDeferral(event)}><BaseerFormSection title={language === "ar" ? "بيانات التأجيل" : "Deferral details"}><BaseerFormGrid><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deductionDeferralForm.businessDate} onChange={(businessDate) => setDeductionDeferralForm((value) => ({ ...value, businessDate }))} /></label><label>{text.plannedPayrollDate}<BaseerDatePicker language={language} label={text.plannedPayrollDate} min={deductionDeferralForm.businessDate} value={deductionDeferralForm.deferredUntil} onChange={(deferredUntil) => setDeductionDeferralForm((value) => ({ ...value, deferredUntil }))} /></label><label className="baseer-form-field--full">{text.deferralReason}<BaseerTextArea compact required value={deductionDeferralForm.reason} onValueChange={(reason) => setDeductionDeferralForm((value) => ({ ...value, reason }))} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionCancellationOpen} title={text.cancelDeduction} language={language} busy={saving} size="compact" formId="hr-administrative-deduction-cancel-form" submitLabel={text.save} onClose={() => setDeductionCancellationOpen(false)}><form id="hr-administrative-deduction-cancel-form" className="baseer-form" onSubmit={(event) => void saveDeductionCancellation(event)}><BaseerFormSection title={language === "ar" ? "قرار الإلغاء" : "Cancellation decision"}><BaseerFormGrid><label>{text.date}<BaseerDatePicker language={language} label={text.date} max={today()} value={deductionCancellationForm.businessDate} onChange={(businessDate) => setDeductionCancellationForm((value) => ({ ...value, businessDate }))} /></label><label className="baseer-form-field--full">{text.deferralReason}<BaseerTextArea compact required value={deductionCancellationForm.reason} onValueChange={(reason) => setDeductionCancellationForm((value) => ({ ...value, reason }))} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
  </BaseerWorkspace>;
}

function filter<T>(rows: readonly T[], value: string, fields: (row: T) => Array<string | null | undefined>) { const term = value.trim().toLowerCase(); return term ? rows.filter((row) => fields(row).filter(Boolean).join(" ").toLowerCase().includes(term)) : rows; }
function movementLabel(text: ReturnType<typeof hrText>, value: string) { return ({ SERVICE_COST: text.serviceCost, PAYROLL_ACCRUAL: text.payrollAccrual, PAYROLL_PAYMENT: text.payrollPayment, ADVANCE_ISSUED: text.advanceIssued, ADVANCE_SETTLEMENT: text.advanceSettlement })[value as "SERVICE_COST"] ?? value; }
function deductionIsOpen(value: HrAdministrativeDeduction) { return value.status === "OPEN" || value.status === "PARTIALLY_APPLIED" || value.status === "DEFERRED"; }
function deductionStatusLabel(text: ReturnType<typeof hrText>, value: HrAdministrativeDeduction["status"]) { return ({ OPEN: text.deductionOpen, PARTIALLY_APPLIED: text.deductionPartiallyApplied, APPLIED: text.deductionApplied, DEFERRED: text.deductionDeferredStatus, CANCELLED: text.cancelled })[value]; }
function deductionActionLabel(text: ReturnType<typeof hrText>, value: HrAdministrativeDeductionDetail["actions"][number]["actionType"]) { return ({ CREATED: text.addAdministrativeDeduction, DEFERRED: text.deferDeduction, CANCELLED: text.cancelDeduction, APPLIED: text.payrollPayment, REVERSED: text.cancelled })[value]; }
