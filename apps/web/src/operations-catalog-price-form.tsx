import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { normalizeBaseerNumericInput } from "./number-format";

type Language = "ar" | "en";
type Values = { price: string };

/**
 * The price remains a decimal string until the server validates and persists
 * it. This form owns only local required-field feedback and focus behaviour.
 */
export function OperationsCatalogPriceForm({ formId, language, value, onSubmit }: {
  formId: string;
  language: Language;
  value: string;
  onSubmit: (value: Values) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = ar ? { price: "سعر بيع المنيو", required: "أدخل السعر." } : { price: "Menu sale price", required: "Enter a price." };
  const schema = useMemo(() => z.object({ price: z.string().trim().min(1, text.required) }), [text.required]);
  const form = useBaseerForm<Values>({ schema, defaultValues: { price: value }, shouldFocusError: true });
  const price = form.watch("price");
  useEffect(() => { form.reset({ price: value }); }, [form, value]);
  return <form id={formId} className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
    <label>{text.price}<input inputMode="decimal" dir="ltr" lang="en" value={price} aria-invalid={Boolean(form.formState.errors.price)} onChange={(event) => form.setValue("price", normalizeBaseerNumericInput(event.target.value), { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.price ? <small role="alert">{form.formState.errors.price.message}</small> : null}</label>
  </form>;
}
