import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
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
  const form = useForm<SupplierForm>({ defaultValues: value, resolver: zodResolver(validation), shouldFocusError: true });
  const type = form.watch("supplierType");
  const categoriesForType = categories.filter((category) => category.status === "ACTIVE" && category.isPosting && category.kind === type);

  useEffect(() => { if (open) form.reset(value); }, [form, open, value]);

  return <BaseerDialog open={open} title={`${editing ? text.edit : text.add} ${text.supplier}`} language={language} busy={busy} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{text.cancel}</BaseerButton><BaseerButton type="submit" form="baseer-supplier-form" variant="primary" disabled={busy}>{busy ? text.saving : text.save}</BaseerButton></>}>
    <form id="baseer-supplier-form" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
      <label>{text.nameArabic}<input autoFocus aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
      <label>{text.nameEnglish}<input {...form.register("nameEn")} /></label>
      <label>{text.phone}<input inputMode="tel" {...form.register("phone")} /></label>
      <label>{text.taxNumber}<input {...form.register("taxNumber")} /></label>
      <label>{text.invoiceType}<select {...form.register("supplierType")} onChange={(event) => { form.setValue("supplierType", event.target.value as SupplierForm["supplierType"], { shouldDirty: true }); form.setValue("categoryId", "", { shouldDirty: true, shouldValidate: true }); }}><option value="PURCHASE">{text.purchaseInvoice}</option><option value="EXPENSE">{text.expenseInvoice}</option></select></label>
      <label>{text.defaultCategory}<select aria-invalid={Boolean(form.formState.errors.categoryId)} {...form.register("categoryId")}><option value="">{text.selectCategory}</option>{categoriesForType.map((category) => <option value={category.id} key={category.id}>{displayName(language, category)}</option>)}</select>{form.formState.errors.categoryId ? <small role="alert">{form.formState.errors.categoryId.message}</small> : null}</label>
      <label><input type="checkbox" {...form.register("isTaxRegistered")} /> {text.taxRegistered}</label>
    </form>
  </BaseerDialog>;
}
