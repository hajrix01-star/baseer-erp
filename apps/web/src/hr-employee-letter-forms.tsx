import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerTextArea, BaseerTextInput } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerButton } from "./baseer-button";
import { BaseerNotice } from "./baseer-workspace";
import type { HrEmployeeLetterType } from "./hr-client";

type Language = "ar" | "en";
export type IssueLetterForm = { letterType: HrEmployeeLetterType; locale: Language; recipient: string };
export type RevokeLetterForm = { reason: string };

function issueSchema() {
  return z.object({ letterType: z.enum(["SALARY_CERTIFICATE", "SERVICE_CERTIFICATE"]), locale: z.enum(["ar", "en"]), recipient: z.string() });
}

function revokeSchema(ar: boolean) {
  return z.object({ reason: z.string().trim().min(1, ar ? "أدخل سبب الإلغاء." : "Enter a revocation reason.") });
}

export function HrEmployeeLetterIssueDialog({ open, language, busy, hasCurrentCompensation, onClose, onManageCompensation, onSubmit }: { open: boolean; language: Language; busy: boolean; hasCurrentCompensation: boolean; onClose: () => void; onManageCompensation: () => void; onSubmit: (value: IssueLetterForm) => Promise<void> | void }) {
  const ar = language === "ar";
  const schema = useMemo(() => issueSchema(), []);
  const form = useBaseerForm<IssueLetterForm>({ defaultValues: { letterType: "SALARY_CERTIFICATE", locale: language, recipient: "" }, schema: schema, shouldFocusError: true });
  const value = form.watch();
  useEffect(() => { if (open) form.reset({ letterType: hasCurrentCompensation ? "SALARY_CERTIFICATE" : "SERVICE_CERTIFICATE", locale: language, recipient: "" }); }, [form, hasCurrentCompensation, language, open]);
  const typeLabels: Record<HrEmployeeLetterType, string> = ar
    ? { SALARY_CERTIFICATE: "خطاب تعريف بالراتب", SERVICE_CERTIFICATE: "شهادة خدمة" }
    : { SALARY_CERTIFICATE: "Salary certificate", SERVICE_CERTIFICATE: "Service certificate" };
  const localeLabels: Record<Language, string> = ar ? { ar: "العربية", en: "الإنجليزية" } : { ar: "Arabic", en: "English" };

  return <BaseerFormDialog open={open} title={ar ? "إصدار خطاب موظف" : "Issue employee letter"} language={language} busy={busy} size="standard" formId="hr-employee-letter-issue" submitLabel={ar ? "إصدار الخطاب" : "Issue letter"} onClose={onClose}>
    <form id="hr-employee-letter-issue" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((values) => void onSubmit(values))}>{!hasCurrentCompensation ? <BaseerNotice tone="warning" title={ar ? "لا يوجد راتب ساري" : "No current salary"}>{ar ? "لا يمكن إصدار خطاب تعريف بالراتب قبل تحديد راتب الموظف." : "A salary certificate requires a current employee salary."} <BaseerButton type="button" variant="quiet" onClick={() => { onClose(); onManageCompensation(); }}>{ar ? "تحديد الراتب" : "Set salary"}</BaseerButton></BaseerNotice> : null}<BaseerFormSection title={ar ? "بيانات الخطاب" : "Letter details"}><BaseerFormGrid>
      <label>{ar ? "نوع الخطاب" : "Letter type"}<BaseerStaticSelect label={ar ? "نوع الخطاب" : "Letter type"} value={value.letterType} onChange={(event) => form.setValue("letterType", event.target.value as HrEmployeeLetterType, { shouldDirty: true })}><option disabled={!hasCurrentCompensation} value="SALARY_CERTIFICATE">{typeLabels.SALARY_CERTIFICATE}</option><option value="SERVICE_CERTIFICATE">{typeLabels.SERVICE_CERTIFICATE}</option></BaseerStaticSelect></label>
      <label>{ar ? "لغة الخطاب" : "Letter language"}<BaseerStaticSelect label={ar ? "لغة الخطاب" : "Letter language"} value={value.locale} onChange={(event) => form.setValue("locale", event.target.value as Language, { shouldDirty: true })}><option value="ar">{localeLabels.ar}</option><option value="en">{localeLabels.en}</option></BaseerStaticSelect></label>
      <label className="baseer-form-field--full">{ar ? "موجه إلى" : "Recipient"}<BaseerTextInput {...form.register("recipient")} /></label>
    </BaseerFormGrid></BaseerFormSection></form>
  </BaseerFormDialog>;
}

export function HrEmployeeLetterRevokeDialog({ open, language, busy, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; onClose: () => void; onSubmit: (value: RevokeLetterForm) => Promise<void> | void }) {
  const ar = language === "ar";
  const schema = useMemo(() => revokeSchema(ar), [ar]);
  const form = useBaseerForm<RevokeLetterForm>({ defaultValues: { reason: "" }, schema: schema, shouldFocusError: true });
  const value = form.watch();
  useEffect(() => { if (open) form.reset({ reason: "" }); }, [form, open]);

  return <BaseerFormDialog open={open} title={ar ? "إلغاء الخطاب" : "Revoke letter"} language={language} busy={busy} size="compact" formId="hr-employee-letter-revoke" submitLabel={ar ? "تأكيد الإلغاء" : "Confirm revocation"} onClose={onClose}>
    <form id="hr-employee-letter-revoke" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((values) => void onSubmit(values))}><BaseerFormSection title={ar ? "سبب الإلغاء" : "Revocation reason"}><BaseerFormGrid columns="one"><label>{ar ? "سبب الإلغاء" : "Revocation reason"}<BaseerTextArea compact value={value.reason} onValueChange={(reason) => form.setValue("reason", reason, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.reason ? <small role="alert">{form.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form>
  </BaseerFormDialog>;
}
