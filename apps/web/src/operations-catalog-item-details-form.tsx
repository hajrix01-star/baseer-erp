import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerTextInput } from "./baseer-form-fields";

type Language = "ar" | "en";
type Kind = "RAW_MATERIAL" | "MENU_PRODUCT";
type Section = { id: string; nameAr: string; nameEn: string | null; isActive: boolean };

export type OperationsCatalogItemDetails = {
  itemId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  sectionId: string;
  kind: Kind;
};

function schema(language: Language) {
  const ar = language === "ar";
  return z.object({
    code: z.string().trim().min(1, ar ? "أدخل رمز الصنف." : "Enter an item code."),
    nameAr: z.string().trim().min(1, ar ? "أدخل اسم الصنف بالعربية." : "Enter the Arabic item name."),
    nameEn: z.string(),
    sectionId: z.string(),
  });
}

/**
 * Lazy Baseer-form adapter for the non-price details of an existing catalog
 * item. Financial price and conversion commands deliberately remain in their
 * separate command families.
 */
export function OperationsCatalogItemDetailsForm({ formId, language, value, sections, onSubmit }: {
  formId: string;
  language: Language;
  value: OperationsCatalogItemDetails;
  sections: readonly Section[];
  onSubmit: (value: OperationsCatalogItemDetails) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = ar ? { code: "الرمز", nameAr: "الاسم بالعربية", nameEn: "الاسم بالإنجليزية", section: "قسم التسجيل", choose: "اختر القسم أولاً." } : { code: "Code", nameAr: "Arabic name", nameEn: "English name", section: "Registration section", choose: "Choose a registration section." };
  const validation = useMemo(() => schema(language).superRefine((next, context) => {
    if (value.kind === "MENU_PRODUCT" && !next.sectionId) context.addIssue({ code: "custom", path: ["sectionId"], message: text.choose });
  }), [language, text.choose, value.kind]);
  const form = useBaseerForm<Pick<OperationsCatalogItemDetails, "code" | "nameAr" | "nameEn" | "sectionId">>({ schema: validation, defaultValues: value, shouldFocusError: true });
  useEffect(() => { form.reset(value); }, [form, value]);
  const sectionId = form.watch("sectionId");
  const name = (section: Section) => ar ? section.nameAr : section.nameEn ?? section.nameAr;

  return <form id={formId} className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit({ ...value, ...next }))}>
    <label>{text.code}<BaseerTextInput autoFocus aria-invalid={Boolean(form.formState.errors.code)} {...form.register("code")} />{form.formState.errors.code ? <small role="alert">{form.formState.errors.code.message}</small> : null}</label>
    <label>{text.nameAr}<BaseerTextInput aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
    <label>{text.nameEn}<BaseerTextInput {...form.register("nameEn")} /></label>
    {value.kind === "MENU_PRODUCT" ? <label>{text.section}<BaseerCombobox label={text.section} placeholder="—" value={sectionId} required invalid={Boolean(form.formState.errors.sectionId)} options={sections.filter((section) => section.isActive).map((section) => ({ id: section.id, label: name(section) }))} onChange={(sectionId) => form.setValue("sectionId", sectionId, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.sectionId ? <small role="alert">{form.formState.errors.sectionId.message}</small> : null}</label> : null}
  </form>;
}
