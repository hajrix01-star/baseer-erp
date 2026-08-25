import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerCheckbox, BaseerTextInput } from "./baseer-form-fields";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import type { SupplierForm } from "./finance-setup-workspace";

type Category = { id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" | "SALE"; status: "ACTIVE" | "ARCHIVED"; isPosting: boolean };

function supplierSchema(ar: boolean) {
  return z.object({
    nameAr: z.string().trim().min(1, ar ? "أدخل اسم المورد بالعربية." : "Enter the supplier name in Arabic."),
    nameEn: z.string(),
    phone: z.string(),
    taxNumber: z.string(),
    supplierType: z.enum(["PURCHASE", "EXPENSE"]),
    categoryId: z.string().min(1, ar ? "اختر فئة افتراضية." : "Choose a default category."),
    isTaxRegistered: z.boolean(),
  });
}

/**
 * Finance supplier input stays behind a Baseer adapter. Zod/RHF improve only
 * the local entry experience; the API remains the financial source of truth.
 */
export function FinanceSupplierFormDialog({ open, language, busy, value, editing, categories, onClose, onSubmit }: {
  open: boolean;
  language: "ar" | "en";
  busy: boolean;
  value: SupplierForm;
  editing: boolean;
  categories: readonly Category[];
  onClose: () => void;
  onSubmit: (value: SupplierForm) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = financeText(language);
  const validation = useMemo(() => supplierSchema(ar), [ar]);
  const form = useBaseerForm<SupplierForm>({ defaultValues: value, schema: validation, shouldFocusError: true });
  const type = form.watch("supplierType");
  const categoryId = form.watch("categoryId");
  const categoriesForType = categories.filter((category) => category.status === "ACTIVE" && category.isPosting && category.kind === type);

  useEffect(() => { if (open) form.reset(value); }, [form, open, value]);

  return <BaseerDialog open={open} title={`${editing ? text.edit : text.add} ${text.supplier}`} language={language} busy={busy} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{text.cancel}</BaseerButton><BaseerButton type="submit" form="baseer-supplier-form" variant="primary" disabled={busy}>{busy ? text.saving : text.save}</BaseerButton></>}>
    <form id="baseer-supplier-form" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
      <label>{text.nameArabic}<BaseerTextInput autoFocus aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
      <label>{text.nameEnglish}<BaseerTextInput {...form.register("nameEn")} /></label>
      <label>{text.phone}<BaseerTextInput inputMode="tel" {...form.register("phone")} /></label>
      <label>{text.taxNumber}<BaseerTextInput {...form.register("taxNumber")} /></label>
      <label>{text.invoiceType}<BaseerStaticSelect label={text.invoiceType} {...form.register("supplierType")} onChange={(event) => { form.setValue("supplierType", event.target.value as SupplierForm["supplierType"], { shouldDirty: true }); form.setValue("categoryId", "", { shouldDirty: true, shouldValidate: true }); }}><option value="PURCHASE">{text.purchaseInvoice}</option><option value="EXPENSE">{text.expenseInvoice}</option></BaseerStaticSelect></label>
      <label>{text.defaultCategory}<BaseerCombobox required label={text.defaultCategory} value={categoryId} placeholder={text.selectCategory} options={categoriesForType.map((category) => ({ id: category.id, label: displayName(language, category) }))} invalid={Boolean(form.formState.errors.categoryId)} onChange={(nextCategoryId) => form.setValue("categoryId", nextCategoryId, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.categoryId ? <small role="alert">{form.formState.errors.categoryId.message}</small> : null}</label>
      <label><BaseerCheckbox {...form.register("isTaxRegistered")} /> {text.taxRegistered}</label>
    </form>
  </BaseerDialog>;
}
