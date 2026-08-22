import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { BaseerFormDialog } from "./baseer-form-dialog";

export type OperationsUnitForm = { nameAr: string; nameEn: string; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE"; isActive: boolean };

const dimensions = ["COUNT", "MASS", "VOLUME", "PACKAGE"] as const;

function unitSchema(ar: boolean) {
  return z.object({
    nameAr: z.string().trim().min(1, ar ? "أدخل اسم الوحدة بالعربية." : "Enter the Arabic unit name."),
    nameEn: z.string(),
    dimension: z.enum(dimensions),
    isActive: z.boolean(),
  });
}

/** Unit definitions are operational metadata; business use remains validated by the API. */
export function OperationsUnitFormDialog({ open, language, busy, value, editingCode, onClose, onSubmit }: {
  open: boolean;
  language: "ar" | "en";
  busy: boolean;
  value: OperationsUnitForm;
  editingCode: string | null;
  onClose: () => void;
  onSubmit: (value: OperationsUnitForm) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = ar ? { add: "إضافة وحدة", edit: "تعديل وحدة", save: "حفظ", nameAr: "الاسم بالعربية", nameEn: "الاسم بالإنجليزية", dimension: "البعد", active: "نشط", COUNT: "عدد", MASS: "وزن", VOLUME: "حجم", PACKAGE: "تغليف" } : { add: "Add unit", edit: "Edit unit", save: "Save", nameAr: "Arabic name", nameEn: "English name", dimension: "Dimension", active: "Active", COUNT: "Count", MASS: "Mass", VOLUME: "Volume", PACKAGE: "Package" };
  const validation = useMemo(() => unitSchema(ar), [ar]);
  const form = useForm<OperationsUnitForm>({ defaultValues: value, resolver: zodResolver(validation), shouldFocusError: true });
  useEffect(() => { if (open) form.reset(value); }, [form, open, value]);
  const editing = editingCode !== null;
  return <BaseerFormDialog open={open} title={editing ? text.edit : text.add} language={language} formId="operations-unit" submitLabel={text.save} busy={busy} onClose={onClose}>
    <form id="operations-unit" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
      {editingCode ? <p><bdi>{editingCode}</bdi></p> : null}
      <label>{text.nameAr}<input autoFocus aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
      <label>{text.nameEn}<input {...form.register("nameEn")} /></label>
      <label>{text.dimension}<select disabled={editing} {...form.register("dimension")}>{dimensions.map((dimension) => <option key={dimension} value={dimension}>{text[dimension]}</option>)}</select></label>
      {editing ? <label><input type="checkbox" {...form.register("isActive")} /> {text.active}</label> : null}
    </form>
  </BaseerFormDialog>;
}
