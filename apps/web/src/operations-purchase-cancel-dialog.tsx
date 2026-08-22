import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { BaseerFormDialog } from "./baseer-form-dialog";

type Language = "ar" | "en";
function schema(language: Language) { const ar = language === "ar"; return z.object({ reason: z.string().trim().min(3, ar ? "اكتب سبب الإلغاء بثلاثة أحرف على الأقل." : "Enter a cancellation reason of at least three characters.") }); }
type FormValues = z.infer<ReturnType<typeof schema>>;

export function OperationsPurchaseCancelDialog({ open, language, busy, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<void> | void }) {
  const ar = language === "ar";
  const text = ar ? { title: "إلغاء", submit: "إلغاء الطلب", reason: "سبب الإلغاء" } : { title: "Cancel", submit: "Cancel request", reason: "Cancellation reason" };
  const form = useForm<FormValues>({ resolver: zodResolver(schema(language)), defaultValues: { reason: "" } });
  useEffect(() => { if (open) form.reset({ reason: "" }); }, [form, open]);
  return <BaseerFormDialog open={open} title={text.title} language={language} formId="purchase-cancel" submitLabel={text.submit} busy={busy} onClose={onClose}><form id="purchase-cancel" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((value) => void onSubmit(value.reason))}><label>{text.reason}<input aria-invalid={Boolean(form.formState.errors.reason)} {...form.register("reason")} />{form.formState.errors.reason ? <small role="alert">{form.formState.errors.reason.message}</small> : null}</label></form></BaseerFormDialog>;
}
