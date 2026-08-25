import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerTextArea, BaseerTextInput } from "./baseer-form-fields";

type Language = "ar" | "en";
export type AssetRegistrationForm = { nameAr: string; nameEn: string; serialNumber: string; location: string; warrantyProvider: string; warrantyStartsAt: string; warrantyEndsAt: string; warrantyTerms: string; lines: string };
const empty = (): AssetRegistrationForm => ({ nameAr: "", nameEn: "", serialNumber: "", location: "", warrantyProvider: "", warrantyStartsAt: "", warrantyEndsAt: "", warrantyTerms: "", lines: "" });

function schema(ar: boolean) {
  return z.object({ nameAr: z.string().trim().min(1, ar ? "أدخل اسم الأصل." : "Enter the asset name."), nameEn: z.string(), serialNumber: z.string(), location: z.string(), warrantyProvider: z.string(), warrantyStartsAt: z.string(), warrantyEndsAt: z.string(), warrantyTerms: z.string(), lines: z.string() }).refine((value) => !value.warrantyStartsAt || !value.warrantyEndsAt || value.warrantyEndsAt >= value.warrantyStartsAt, { path: ["warrantyEndsAt"], message: ar ? "نهاية الضمان لا تسبق بدايته." : "Warranty end cannot precede its start." });
}

export function OperationsAssetRegisterDialog({ open, language, busy, sourceDocumentNumber, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; sourceDocumentNumber: string; onClose: () => void; onSubmit: (value: AssetRegistrationForm) => Promise<void> | void }) {
  const ar = language === "ar";
  const validation = useMemo(() => schema(ar), [ar]);
  const form = useBaseerForm<AssetRegistrationForm>({ defaultValues: empty(), schema: validation, shouldFocusError: true });
  const value = form.watch();
  useEffect(() => { if (open) form.reset(empty()); }, [form, open]);
  const t = ar ? { title: "تسجيل أصل", name: "اسم الأصل", serial: "الرقم التسلسلي", location: "الموقع", provider: "مزود الضمان", start: "بداية الضمان", end: "نهاية الضمان", terms: "شروط الضمان", lines: "بنود الضمان", hint: "بند واحد في كل سطر", save: "حفظ السجل", cancel: "إلغاء" } : { title: "Register asset", name: "Asset name", serial: "Serial number", location: "Location", provider: "Warranty provider", start: "Warranty start", end: "Warranty end", terms: "Warranty terms", lines: "Warranty items", hint: "One item per line", save: "Save record", cancel: "Cancel" };
  return <BaseerDialog open={open} language={language} title={t.title} busy={busy} onClose={onClose} footer={<><BaseerButton type="button" onClick={onClose}>{t.cancel}</BaseerButton><BaseerButton form="asset-register" type="submit" disabled={busy}>{t.save}</BaseerButton></>}><form id="asset-register" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((values) => void onSubmit(values))}><p>{sourceDocumentNumber}</p><label>{t.name}<BaseerTextInput aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label><label>{ar ? "الاسم بالإنجليزية" : "English name"}<BaseerTextInput {...form.register("nameEn")} /></label><label>{t.serial}<BaseerTextInput {...form.register("serialNumber")} /></label><label>{t.location}<BaseerTextInput {...form.register("location")} /></label><label>{t.provider}<BaseerTextInput {...form.register("warrantyProvider")} /></label><BaseerDatePicker language={language} label={t.start} clearable value={value.warrantyStartsAt} onChange={(next) => form.setValue("warrantyStartsAt", next, { shouldDirty: true, shouldValidate: true })} /><BaseerDatePicker language={language} label={t.end} clearable value={value.warrantyEndsAt} onChange={(next) => form.setValue("warrantyEndsAt", next, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.warrantyEndsAt ? <small role="alert">{form.formState.errors.warrantyEndsAt.message}</small> : null}<label>{t.terms}<BaseerTextArea {...form.register("warrantyTerms")} /></label><label>{t.lines}<BaseerTextArea placeholder={t.hint} {...form.register("lines")} /></label></form></BaseerDialog>;
}
