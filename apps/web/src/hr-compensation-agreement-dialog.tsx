import { useEffect, useMemo, useRef, useState } from "react";

import "./hr-compensation-agreement-dialog.css";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerMoneyInput, normalizeBaseerAmount } from "./baseer-form-fields";
import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { BaseerMoney } from "./baseer-money";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { activeSession, requestId } from "./daily-sales-client";
import { addMoneyDecimals, isPositiveMoneyDecimal, normalizeMoneyDecimal, subtractMoneyDecimals, tryMoneyDecimal } from "./decimal-string";
import { setHrEmployeeCompensation, type HrCompensationMethod, type HrCompensationProfile, type HrEmployee } from "./hr-client";

type Language = "ar" | "en";
type SalaryOperation = "FULL" | "INCREASE" | "DECREASE";
type Draft = {
  employeeId: string;
  policyVersionId: string;
  effectiveFrom: string;
  monthlyGross: string;
  compensationMethod: HrCompensationMethod;
  foodAllowance: string;
  housingAllowance: string;
  transportAllowance: string;
  otherAllowance: string;
  scheduledHoursPerDay: string;
  scheduledWorkDays: string;
  notes: string;
};

const month = (offset = 0) => {
  const value = new Date();
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
};
const employeeLabel = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;
const operationCopy = (language: Language, operation: SalaryOperation) => ({
  FULL: language === "ar" ? { label: "تعديل شامل", description: "الراتب والبدلات" } : { label: "Full edit", description: "Salary and allowances" },
  INCREASE: language === "ar" ? { label: "زيادة راتب", description: "أدخل مبلغ الزيادة" } : { label: "Increase", description: "Enter the increase amount" },
  DECREASE: language === "ar" ? { label: "تخفيض راتب", description: "أدخل مبلغ التخفيض" } : { label: "Decrease", description: "Enter the decrease amount" },
})[operation];
const empty = (employeeId = "", profile?: HrCompensationProfile | null): Draft => ({
  employeeId,
  policyVersionId: profile?.policyVersionId ?? "",
  effectiveFrom: `${month(profile ? 1 : 0)}-01`,
  monthlyGross: profile?.monthlyGross ?? "",
  compensationMethod: profile?.compensationMethod ?? "FIXED_MONTHLY",
  foodAllowance: profile?.foodAllowance ?? "",
  housingAllowance: profile?.housingAllowance ?? "",
  transportAllowance: profile?.transportAllowance ?? "",
  otherAllowance: profile?.otherAllowance ?? "",
  scheduledHoursPerDay: profile?.scheduledHoursPerDay?.toString() ?? "",
  scheduledWorkDays: profile?.scheduledWorkDays?.toString() ?? "",
  notes: "",
});

/** One compact workflow for salary-only changes. Promotions remain part of the
 * employment path so salary history and promotion history retain their roles. */
export function HrCompensationAgreementDialog({ open, language, employees, fixedEmployeeId, profile, onClose, onSaved, onError }: { open: boolean; language: Language; employees: readonly HrEmployee[]; fixedEmployeeId?: string; profile?: HrCompensationProfile | null; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<SalaryOperation>("FULL");
  const [draft, setDraft] = useState<Draft>(() => empty(fixedEmployeeId, profile));
  const [changeAmount, setChangeAmount] = useState("");
  const submissionKey = useRef(requestId());

  useEffect(() => {
    if (!open) return;
    setOperation("FULL");
    setDraft(empty(fixedEmployeeId, profile));
    setChangeAmount("");
    submissionKey.current = requestId();
  }, [fixedEmployeeId, open, profile]);

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  const existingSalary = profile ?? null;
  const nextSalary = tryMoneyDecimal(() => operation === "FULL"
    ? normalizeMoneyDecimal(draft.monthlyGross)
    : operation === "INCREASE"
      ? addMoneyDecimals(existingSalary!.monthlyGross, changeAmount)
      : subtractMoneyDecimals(existingSalary!.monthlyGross, changeAmount));
  const fullEdit = operation === "FULL";
  const requiresOvertimeSchedule = fullEdit && draft.compensationMethod === "INCLUSIVE_OVERTIME";
  const selectedEmployee = activeEmployees.find((employee) => employee.id === draft.employeeId);
  const salarySchema = useMemo(() => {
    const decimal = baseerDecimalString(ar ? "أدخل مبلغاً عشرياً صحيحاً." : "Enter a valid decimal amount.", 4, 14);
    const optionalDecimal = z.string().refine((value) => !value.trim() || decimal.safeParse(value.trim()).success, ar ? "أدخل مبلغاً عشرياً صحيحاً." : "Enter a valid decimal amount.");
    return z.object({
      employeeId: z.string().min(1, ar ? "اختر الموظف." : "Choose an employee."),
      policyVersionId: z.string(),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-01$/, ar ? "اختر شهر التطبيق." : "Choose the effective month."),
      monthlyGross: optionalDecimal,
      compensationMethod: z.enum(["FIXED_MONTHLY", "INCLUSIVE_OVERTIME"]),
      foodAllowance: optionalDecimal,
      housingAllowance: optionalDecimal,
      transportAllowance: optionalDecimal,
      otherAllowance: optionalDecimal,
      scheduledHoursPerDay: z.string(),
      scheduledWorkDays: z.string(),
      notes: z.string(),
      changeAmount: optionalDecimal,
      operation: z.enum(["FULL", "INCREASE", "DECREASE"]),
    }).superRefine((value, context) => {
      const positive = (input: string) => decimal.safeParse(input.trim()).success && !/^0+(?:\.0+)?$/.test(input.trim());
      if (value.operation === "FULL" && !positive(value.monthlyGross)) context.addIssue({ code: "custom", path: ["monthlyGross"], message: ar ? "أدخل راتباً أكبر من صفر." : "Enter a salary greater than zero." });
      if (value.operation !== "FULL" && !positive(value.changeAmount)) context.addIssue({ code: "custom", path: ["changeAmount"], message: ar ? "أدخل مبلغ تعديل أكبر من صفر." : "Enter an adjustment amount greater than zero." });
      if (value.operation === "FULL" && value.compensationMethod === "INCLUSIVE_OVERTIME") {
        if (!/^(?:9|10|11|12)$/.test(value.scheduledHoursPerDay)) context.addIssue({ code: "custom", path: ["scheduledHoursPerDay"], message: ar ? "أدخل من 9 إلى 12 ساعة." : "Enter 9 to 12 hours." });
        if (!/^(?:[1-9]|[12]\d|3[01])$/.test(value.scheduledWorkDays)) context.addIssue({ code: "custom", path: ["scheduledWorkDays"], message: ar ? "أدخل من يوم إلى 31 يوماً." : "Enter 1 to 31 days." });
      }
    });
  }, [ar]);
  const salaryForm = useBaseerForm<Draft & { changeAmount: string; operation: SalaryOperation }>({ schema: salarySchema, values: { ...draft, changeAmount, operation } });

  const submit = async () => {
    const session = activeSession();
    if (!session || busy) return;
    if (!fullEdit && !isPositiveMoneyDecimal(changeAmount)) { onError(ar ? "أدخل مبلغ التعديل أكبر من صفر." : "Enter an adjustment amount greater than zero."); return; }
    if (!nextSalary || !isPositiveMoneyDecimal(nextSalary)) { onError(ar ? "لا يمكن أن يصبح الراتب صفراً أو أقل أو يتجاوز حد الدقة المالية." : "The salary cannot become zero or less or exceed the financial precision limit."); return; }
    if (requiresOvertimeSchedule && (!Number.isInteger(Number(draft.scheduledHoursPerDay)) || Number(draft.scheduledHoursPerDay) < 9 || Number(draft.scheduledHoursPerDay) > 12 || !Number.isInteger(Number(draft.scheduledWorkDays)) || Number(draft.scheduledWorkDays) < 1 || Number(draft.scheduledWorkDays) > 31)) { onError(ar ? "للراتب الشامل للأوفر تايم، أدخل ساعات الدوام من 9 إلى 12 وأيام العمل الشهرية." : "For inclusive overtime, enter daily hours from 9 to 12 and monthly work days."); return; }
    const method = fullEdit ? draft.compensationMethod : existingSalary!.compensationMethod;
    setBusy(true);
    try {
      await setHrEmployeeCompensation(session, {
        employeeId: draft.employeeId,
        policyVersionId: draft.policyVersionId || undefined,
        effectiveFrom: draft.effectiveFrom,
        monthlyGross: nextSalary,
        compensationMethod: method,
        foodAllowance: (fullEdit ? draft.foodAllowance : existingSalary!.foodAllowance) || "0",
        housingAllowance: (fullEdit ? draft.housingAllowance : existingSalary!.housingAllowance) || "0",
        transportAllowance: (fullEdit ? draft.transportAllowance : existingSalary!.transportAllowance) || "0",
        otherAllowance: (fullEdit ? draft.otherAllowance : existingSalary!.otherAllowance) || "0",
        ...(method === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: Number(fullEdit ? draft.scheduledHoursPerDay : existingSalary!.scheduledHoursPerDay), scheduledWorkDays: Number(fullEdit ? draft.scheduledWorkDays : existingSalary!.scheduledWorkDays) } : {}),
        notes: `${operationCopy(language, operation).label}${draft.notes.trim() ? ` — ${draft.notes.trim()}` : ""}`,
        idempotencyKey: submissionKey.current,
      });
      onClose();
      try { await onSaved(); }
      catch (error) { onError(presentBaseerApiError(error, language, ar ? "حُفظ الراتب، لكن تعذر تحديث العرض الحالي." : "The salary was saved, but the current view could not be refreshed.")); }
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر حفظ الراتب." : "The salary could not be saved.")); }
    finally { setBusy(false); }
  };

  const title = existingSalary ? (ar ? "إدارة الراتب" : "Manage salary") : (ar ? "تحديد الراتب" : "Set salary");
  return <BaseerFormDialog open={open} title={title} language={language} busy={busy} size="standard" className="hr-salary-manager-dialog" formId="hr-salary-editor" submitLabel={ar ? "حفظ الراتب" : "Save salary"} onClose={onClose}>
    <form id="hr-salary-editor" className="baseer-form hr-salary-manager" data-baseer-rhf-form="true" noValidate onSubmit={salaryForm.handleSubmit(() => void submit())}>
      <BaseerFormSection title={selectedEmployee ? (ar ? `راتب ${selectedEmployee.nameAr}` : `${selectedEmployee.nameEn ?? selectedEmployee.nameAr} salary`) : (ar ? "بيانات الراتب" : "Salary details")}>
        {existingSalary ? <div className="hr-salary-manager__operations" role="group" aria-label={ar ? "نوع عملية الراتب" : "Salary operation"}>{(["FULL", "INCREASE", "DECREASE"] as const).map((value) => <BaseerButton key={value} type="button" variant={operation === value ? "primary" : "secondary"} className="hr-salary-manager__operation" disabled={busy} onClick={() => setOperation(value)}><span>{operationCopy(language, value).label}</span><small>{operationCopy(language, value).description}</small></BaseerButton>)}</div> : null}
        {existingSalary ? <div className="hr-salary-manager__summary"><div><span>{ar ? "الراتب الحالي" : "Current salary"}</span><strong><BaseerMoney value={existingSalary.monthlyGross} language={language} /></strong></div><div><span>{ar ? "بعد العملية" : "After change"}</span><strong><BaseerMoney value={nextSalary && isPositiveMoneyDecimal(nextSalary) ? nextSalary : "0"} language={language} /></strong></div></div> : null}
        <BaseerFormGrid className="hr-salary-manager__fields">
          {!fixedEmployeeId ? <label className="baseer-form-field baseer-form-field--full">{ar ? "الموظف" : "Employee"}<BaseerCombobox required label={ar ? "الموظف" : "Employee"} value={draft.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }))} onChange={(employeeId) => setDraft((value) => ({ ...value, employeeId }))} />{salaryForm.formState.errors.employeeId ? <small role="alert">{salaryForm.formState.errors.employeeId.message}</small> : null}</label> : null}
          <label className="baseer-form-field">{ar ? "شهر التطبيق" : "Effective month"}<input required type="month" min={month(existingSalary ? 1 : 0)} value={draft.effectiveFrom.slice(0, 7)} onChange={(event) => setDraft((value) => ({ ...value, effectiveFrom: `${event.target.value}-01` }))} /></label>
          {fullEdit ? <label className="baseer-form-field">{ar ? "إجمالي الراتب الشهري" : "Monthly salary"}<BaseerMoneyInput required autoFocus aria-invalid={Boolean(salaryForm.formState.errors.monthlyGross)} value={draft.monthlyGross} onValueChange={(monthlyGross) => setDraft((value) => ({ ...value, monthlyGross }))} />{salaryForm.formState.errors.monthlyGross ? <small role="alert">{salaryForm.formState.errors.monthlyGross.message}</small> : null}</label> : <label className="baseer-form-field">{operation === "INCREASE" ? (ar ? "مبلغ الزيادة" : "Increase amount") : (ar ? "مبلغ التخفيض" : "Decrease amount")}<BaseerMoneyInput required autoFocus aria-invalid={Boolean(salaryForm.formState.errors.changeAmount)} value={changeAmount} onValueChange={setChangeAmount} />{salaryForm.formState.errors.changeAmount ? <small role="alert">{salaryForm.formState.errors.changeAmount.message}</small> : null}</label>}
          {fullEdit ? <details className="baseer-form-advanced" open={requiresOvertimeSchedule}><summary>{ar ? "البدلات وطريقة الاحتساب" : "Allowances & calculation"}</summary><div><label>{ar ? "طريقة الاحتساب" : "Calculation method"}<select value={draft.compensationMethod} onChange={(event) => setDraft((value) => ({ ...value, compensationMethod: event.target.value as HrCompensationMethod }))}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "شامل الأوفر تايم" : "Inclusive overtime"}</option></select></label><label>{ar ? "بدل الأكل" : "Food allowance"}<BaseerMoneyInput value={draft.foodAllowance} onValueChange={(foodAllowance) => setDraft((value) => ({ ...value, foodAllowance }))} /></label><label>{ar ? "بدل السكن" : "Housing allowance"}<BaseerMoneyInput value={draft.housingAllowance} onValueChange={(housingAllowance) => setDraft((value) => ({ ...value, housingAllowance }))} /></label><label>{ar ? "بدل المواصلات" : "Transport allowance"}<BaseerMoneyInput value={draft.transportAllowance} onValueChange={(transportAllowance) => setDraft((value) => ({ ...value, transportAllowance }))} /></label><label>{ar ? "بدلات أخرى" : "Other allowances"}<BaseerMoneyInput value={draft.otherAllowance} onValueChange={(otherAllowance) => setDraft((value) => ({ ...value, otherAllowance }))} /></label>{requiresOvertimeSchedule ? <><label>{ar ? "ساعات الدوام اليومية" : "Daily hours"}<input required inputMode="numeric" dir="ltr" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => setDraft((value) => ({ ...value, scheduledHoursPerDay: normalizeBaseerAmount(event.target.value).replace(".", "") }))} /></label><label>{ar ? "أيام العمل الشهرية" : "Monthly working days"}<input required inputMode="numeric" dir="ltr" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => setDraft((value) => ({ ...value, scheduledWorkDays: normalizeBaseerAmount(event.target.value).replace(".", "") }))} /></label></> : null}</div></details> : null}
          <label className="baseer-form-field baseer-form-field--full">{ar ? "السبب أو الملاحظة (اختياري)" : "Reason or note (optional)"}<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
        </BaseerFormGrid>
      </BaseerFormSection>
    </form>
  </BaseerFormDialog>;
}
