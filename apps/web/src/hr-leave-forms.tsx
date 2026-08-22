import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerTextArea } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerSearchSelect } from "./baseer-search-select";
import type { HrEmployee, HrEmployeeLeave } from "./hr-client";

type Language = "ar" | "en";
export type LeaveForm = { employeeId: string; leaveType: HrEmployeeLeave["leaveType"]; startDate: string; endDate: string; notes: string };
export type ReturnForm = { leaveId: string; returnDate: string; notes: string };
type EmployeeOption = { id: string; label: string };
type RemoteEmployeeSearch = (query: string, signal?: AbortSignal) => Promise<readonly EmployeeOption[]>;

const today = () => new Date().toISOString().slice(0, 10);
const emptyLeave = (): LeaveForm => ({ employeeId: "", leaveType: "ANNUAL", startDate: today(), endDate: today(), notes: "" });
const employeeLabel = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;

function leaveSchema(ar: boolean) {
  const required = ar ? "هذا الحقل مطلوب." : "This field is required.";
  const invalidRange = ar ? "يجب ألا يسبق تاريخ النهاية تاريخ البداية." : "The end date cannot be before the start date.";
  return z.object({
    employeeId: z.string().min(1, required),
    leaveType: z.enum(["ANNUAL", "SICK", "UNPAID", "OTHER"]),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, required),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, required),
    notes: z.string(),
  }).refine((value) => value.endDate >= value.startDate, { path: ["endDate"], message: invalidRange });
}

function returnSchema(ar: boolean) {
  return z.object({
    leaveId: z.string().min(1),
    returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ar ? "أدخل تاريخ العودة." : "Enter a return date."),
    notes: z.string(),
  });
}

export function HrLeaveCreateDialog({ open, language, busy, employees, remoteSearch, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; employees: readonly HrEmployee[]; remoteSearch: RemoteEmployeeSearch; onClose: () => void; onSubmit: (value: LeaveForm) => Promise<void> | void }) {
  const ar = language === "ar";
  const schema = useMemo(() => leaveSchema(ar), [ar]);
  const form = useBaseerForm<LeaveForm>({ defaultValues: emptyLeave(), schema: schema, shouldFocusError: true });
  const value = form.watch();
  useEffect(() => { if (open) form.reset(emptyLeave()); }, [form, open]);
  const typeLabel = (type: HrEmployeeLeave["leaveType"]) => ({ ANNUAL: ar ? "سنوية" : "Annual", SICK: ar ? "مرضية" : "Sick", UNPAID: ar ? "بدون راتب" : "Unpaid", OTHER: ar ? "أخرى" : "Other" })[type];
  const activeEmployees = employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE");

  return <BaseerFormDialog open={open} title={ar ? "تسجيل إجازة" : "Record leave"} language={language} busy={busy} size="standard" formId="hr-leave-create" submitLabel={ar ? "حفظ الإجازة" : "Save leave"} onClose={onClose}>
    <form id="hr-leave-create" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((values) => void onSubmit(values))}><BaseerFormSection title={ar ? "بيانات الإجازة" : "Leave details"}><BaseerFormGrid>
      <label className="baseer-form-field--full">{ar ? "الموظف" : "Employee"}<BaseerSearchSelect required label={ar ? "الموظف" : "Employee"} value={value.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }))} remoteSearch={remoteSearch} onChange={(employeeId) => form.setValue("employeeId", employeeId, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.employeeId ? <small role="alert">{form.formState.errors.employeeId.message}</small> : null}</label>
      <label>{ar ? "النوع" : "Type"}<select value={value.leaveType} onChange={(event) => form.setValue("leaveType", event.target.value as LeaveForm["leaveType"], { shouldDirty: true })}>{(["ANNUAL", "SICK", "UNPAID", "OTHER"] as const).map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label>
      <label>{ar ? "من" : "From"}<BaseerDatePicker language={language} label={ar ? "من" : "From"} value={value.startDate} onChange={(startDate) => form.setValue("startDate", startDate, { shouldDirty: true, shouldValidate: true })} /></label>
      <label>{ar ? "إلى" : "To"}<BaseerDatePicker language={language} label={ar ? "إلى" : "To"} min={value.startDate} value={value.endDate} onChange={(endDate) => form.setValue("endDate", endDate, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.endDate ? <small role="alert">{form.formState.errors.endDate.message}</small> : null}</label>
      <label className="baseer-form-field--full">{ar ? "ملاحظات" : "Notes"}<BaseerTextArea compact value={value.notes} onValueChange={(notes) => form.setValue("notes", notes, { shouldDirty: true })} /></label>
    </BaseerFormGrid></BaseerFormSection></form>
  </BaseerFormDialog>;
}

export function HrLeaveReturnDialog({ open, language, busy, leaveId, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; leaveId: string; onClose: () => void; onSubmit: (value: ReturnForm) => Promise<void> | void }) {
  const ar = language === "ar";
  const schema = useMemo(() => returnSchema(ar), [ar]);
  const form = useBaseerForm<ReturnForm>({ defaultValues: { leaveId: "", returnDate: today(), notes: "" }, schema: schema, shouldFocusError: true });
  const value = form.watch();
  useEffect(() => { if (open) form.reset({ leaveId, returnDate: today(), notes: "" }); }, [form, leaveId, open]);

  return <BaseerFormDialog open={open} title={ar ? "تسجيل العودة إلى العمل" : "Record return to work"} language={language} busy={busy} size="compact" formId="hr-leave-return" submitLabel={ar ? "حفظ العودة" : "Save return"} onClose={onClose}>
    <form id="hr-leave-return" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((values) => void onSubmit(values))}><BaseerFormSection title={ar ? "بيانات العودة" : "Return details"}><BaseerFormGrid columns="one">
      <label>{ar ? "أول يوم للعودة" : "First day back"}<BaseerDatePicker language={language} label={ar ? "أول يوم للعودة" : "First day back"} max={today()} value={value.returnDate} onChange={(returnDate) => form.setValue("returnDate", returnDate, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.returnDate ? <small role="alert">{form.formState.errors.returnDate.message}</small> : null}</label>
      <label>{ar ? "ملاحظات" : "Notes"}<BaseerTextArea compact value={value.notes} onValueChange={(notes) => form.setValue("notes", notes, { shouldDirty: true })} /></label>
    </BaseerFormGrid></BaseerFormSection></form>
  </BaseerFormDialog>;
}
