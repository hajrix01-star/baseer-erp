import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerCheckbox, BaseerTextInput } from "./baseer-form-fields";
import { categoryText } from "./categories-copy";
import { displayName, localizedEnum } from "./baseer-localization";
import { uiCopy } from "./baseer-ui-copy";
import type { Category, CategoryForm, CategoryKind, Supplier } from "./categories-workspace";

function schema(ar: boolean) {
  return z.object({
    code: z.string().trim().min(1, ar ? "أدخل رمز الفئة." : "Enter a category code."),
    nameAr: z.string().trim().min(1, ar ? "أدخل الاسم بالعربية." : "Enter the Arabic name."),
    nameEn: z.string().trim().min(1, ar ? "أدخل الاسم بالإنجليزية." : "Enter the English name."),
    kind: z.enum(["PURCHASE", "EXPENSE", "SALE"]),
    parentId: z.string(),
    suggestedSupplierId: z.string(),
    isPosting: z.boolean(),
  });
}

/** The client validates category entry; account posting rules remain server-side. */
export function FinanceCategoryFormDialog({ open, language, busy, value, editing, categories, suppliers, onClose, onSubmit }: {
  open: boolean;
  language: "ar" | "en";
  busy: boolean;
  value: CategoryForm;
  editing: Category | null;
  categories: readonly Category[];
  suppliers: readonly Supplier[];
  onClose: () => void;
  onSubmit: (value: CategoryForm) => Promise<void> | void;
}) {
  const text = categoryText(language);
  const shared = uiCopy(language);
  const validation = useMemo(() => schema(language === "ar"), [language]);
  const form = useBaseerForm<CategoryForm>({ defaultValues: value, schema: validation, shouldFocusError: true });
  const kind = form.watch("kind");
  const isPosting = form.watch("isPosting");
  const parentId = form.watch("parentId");
  const suggestedSupplierId = form.watch("suggestedSupplierId");
  const active = categories.filter((item) => item.status === "ACTIVE");
  const parentOptions = active.filter((item) => !item.isPosting && item.kind === kind && item.id !== editing?.id);
  const suggestedSupplierOptions = suppliers.filter((item) => item.status === "ACTIVE" && item.supplierType === (kind === "PURCHASE" ? "PURCHASE" : "EXPENSE"));
  useEffect(() => { if (open) form.reset(value); }, [form, open, value]);
  return <BaseerDialog open={open} title={editing ? text.editCategory : text.addCategory} language={language} busy={busy} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{shared.cancel}</BaseerButton><BaseerButton type="submit" form="category-form" variant="primary" disabled={busy}>{editing ? text.save : text.add}</BaseerButton></>}>
    <form id="category-form" className="administration-form" style={{ gridTemplateColumns: "minmax(6.5rem, .72fr) minmax(0, 1.14fr) minmax(0, 1.14fr)", gap: ".55rem" }} data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
      <label>{text.code}<BaseerTextInput autoFocus aria-invalid={Boolean(form.formState.errors.code)} {...form.register("code")} />{form.formState.errors.code ? <small role="alert">{form.formState.errors.code.message}</small> : null}</label>
      <label>{text.nameAr}<BaseerTextInput aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
      <label>{text.nameEn}<BaseerTextInput aria-invalid={Boolean(form.formState.errors.nameEn)} {...form.register("nameEn")} />{form.formState.errors.nameEn ? <small role="alert">{form.formState.errors.nameEn.message}</small> : null}</label>
      <label>{text.kind}<BaseerStaticSelect label={text.kind} disabled={Boolean(editing)} {...form.register("kind")} onChange={(event) => { form.setValue("kind", event.target.value as CategoryKind, { shouldDirty: true }); form.setValue("parentId", "", { shouldDirty: true }); form.setValue("suggestedSupplierId", "", { shouldDirty: true }); }}><option value="PURCHASE">{localizedEnum(language, "PURCHASE")}</option><option value="EXPENSE">{localizedEnum(language, "EXPENSE")}</option><option value="SALE">{localizedEnum(language, "SALE")}</option></BaseerStaticSelect></label>
      <label>{text.parent}<BaseerCombobox label={text.parent} value={parentId} placeholder={text.noParent} options={parentOptions.map((item) => ({ id: item.id, label: displayName(language, item) }))} onChange={(nextParentId) => form.setValue("parentId", nextParentId, { shouldDirty: true, shouldValidate: true })} /></label>
      {kind !== "SALE" && isPosting ? <label>{text.suggestedSupplier}<BaseerCombobox label={text.suggestedSupplier} value={suggestedSupplierId} placeholder={text.noSuggestedSupplier} options={suggestedSupplierOptions.map((item) => ({ id: item.id, label: displayName(language, item) }))} onChange={(nextSupplierId) => form.setValue("suggestedSupplierId", nextSupplierId, { shouldDirty: true, shouldValidate: true })} /></label> : null}
      {editing ? <small style={{ gridColumn: "1 / -1", color: "var(--muted)", fontSize: "var(--font-caption)" }}>{text.accountingTypeFixed}</small> : null}
      <label style={{ gridColumn: "1 / -1" }}><BaseerCheckbox {...form.register("isPosting")} /> {isPosting ? text.acceptsPosting : text.groupOnly}</label>
    </form>
  </BaseerDialog>;
}
