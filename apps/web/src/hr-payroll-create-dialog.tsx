import { useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { activeSession, requestId } from "./daily-sales-client";
import {
  createHrPayrollRun,
  type HrAdministrativeDeduction,
  type HrAdvance,
  type HrEmployee,
} from "./hr-client";

type Language = "ar" | "en";
type LineSelection = { employeeId: string; advances: Record<string, { enabled: boolean; amount: string }>; deductions: Record<string, { enabled: boolean; amount: string }> };

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const employeeLabel = (language: Language, employee: HrEmployee) => language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr;

export function HrPayrollCreateDialog({ open, onClose, onCreated, language, employees, advances, deductions, onError }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  language: Language;
  employees: HrEmployee[];
  advances: HrAdvance[];
  deductions: HrAdministrativeDeduction[];
  onError: (message: string) => void;
}) {
  const ar = language === "ar";
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ payrollMonth: month(), businessDate: today(), notes: "", lines: [] as LineSelection[] });
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  const selected = (employeeId: string) => draft.lines.find((line) => line.employeeId === employeeId);
  const toggleEmployee = (employeeId: string) => setDraft((value) => ({ ...value, lines: selected(employeeId) ? value.lines.filter((line) => line.employeeId !== employeeId) : [...value.lines, { employeeId, advances: {}, deductions: {} }] }));
  const updateApplication = (employeeId: string, kind: "advances" | "deductions", id: string, enabled: boolean, amount: string) => setDraft((value) => ({ ...value, lines: value.lines.map((line) => line.employeeId === employeeId ? { ...line, [kind]: { ...line[kind], [id]: { enabled, amount } } } : line) }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = activeSession();
    if (!session || busy) return;
    setBusy(true);
    try {
      await createHrPayrollRun(session, {
        payrollMonth: draft.payrollMonth,
        businessDate: draft.businessDate,
        notes: draft.notes || undefined,
        lines: draft.lines.map((line) => ({
          employeeId: line.employeeId,
          advances: Object.entries(line.advances).filter(([, item]) => item.enabled && item.amount).map(([id, item]) => ({ id, amount: item.amount })),
          administrativeDeductions: Object.entries(line.deductions).filter(([, item]) => item.enabled && item.amount).map(([id, item]) => ({ id, amount: item.amount })),
        })),
        idempotencyKey: requestId(),
      });
      onClose();
      await onCreated();
    } catch (error) {
      onError(presentBaseerApiError(error, language, ar ? "إنشاء مسير" : "Creating payroll"));
    } finally { setBusy(false); }
  };

  return <BaseerDialog open={open} title={ar ? "إنشاء مسير رواتب" : "Create payroll run"} language={language} busy={busy} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-payroll-create-form" disabled={busy}>{ar ? "حفظ مسودة" : "Save draft"}</BaseerButton></>}>
    <form id="hr-payroll-create-form" className="administration-form" onSubmit={(event) => void submit(event)}>
      <label>{ar ? "شهر المسير" : "Payroll month"}<input required type="month" value={draft.payrollMonth.slice(0, 7)} onChange={(event) => setDraft((value) => ({ ...value, payrollMonth: `${event.target.value}-01` }))} /></label>
      <label>{ar ? "تاريخ الاستحقاق" : "Accrual date"}<input required type="date" max={today()} value={draft.businessDate} onChange={(event) => setDraft((value) => ({ ...value, businessDate: event.target.value }))} /></label>
      <label>{ar ? "ملاحظات" : "Notes"}<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
      <fieldset><legend>{ar ? "الموظفون ومسوّياتهم" : "Employees and applications"}</legend>{activeEmployees.map((employee) => { const line = selected(employee.id); const employeeAdvances = advances.filter((advance) => advance.employeeId === employee.id && advance.remainingAmount !== "0.0000"); const employeeDeductions = deductions.filter((deduction) => deduction.employeeId === employee.id && !["APPLIED", "CANCELLED"].includes(deduction.status)); return <article key={employee.id}><label><input type="checkbox" checked={Boolean(line)} onChange={() => toggleEmployee(employee.id)} /> {employee.employeeNumber} · {employeeLabel(language, employee)}</label>{line ? <div>{employeeAdvances.map((advance) => { const item = line.advances[advance.id] ?? { enabled: false, amount: advance.remainingAmount }; return <label key={advance.id}><input type="checkbox" checked={item.enabled} onChange={(event) => updateApplication(employee.id, "advances", advance.id, event.target.checked, item.amount)} /> {ar ? `سلفة ${advance.advanceNumber}` : `Advance ${advance.advanceNumber}`} <input disabled={!item.enabled} inputMode="decimal" value={item.amount} onChange={(event) => updateApplication(employee.id, "advances", advance.id, item.enabled, event.target.value)} /></label>; })}{employeeDeductions.map((deduction) => { const item = line.deductions[deduction.id] ?? { enabled: false, amount: deduction.remainingAmount }; return <label key={deduction.id}><input type="checkbox" checked={item.enabled} onChange={(event) => updateApplication(employee.id, "deductions", deduction.id, event.target.checked, item.amount)} /> {ar ? `خصم ${deduction.deductionNumber}` : `Deduction ${deduction.deductionNumber}`} <input disabled={!item.enabled} inputMode="decimal" value={item.amount} onChange={(event) => updateApplication(employee.id, "deductions", deduction.id, item.enabled, event.target.value)} /></label>; })}</div> : null}</article>; })}</fieldset>
    </form>
  </BaseerDialog>;
}
