import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

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
  useEffect(() => { form.reset({ price: value }); }, [form, value]);
  return <form id={formId} className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
    <p>{ar ? "سعر البيع محفوظ داخل كرت صنف المنيو، ولا يظهر للموظف في شاشة التسجيل الداخلي." : "The sale price is stored on this menu-product card and is never shown to internal-registration staff."}</p>
    <label>{text.price}<input inputMode="decimal" aria-invalid={Boolean(form.formState.errors.price)} {...form.register("price")} />{form.formState.errors.price ? <small role="alert">{form.formState.errors.price.message}</small> : null}</label>
  </form>;
}
