import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerFormDialog } from "./baseer-form-dialog";

export type CustodyReturnDraft = { requestId: string; businessDate: string; amount: string; notes: string };
type RequestOption = { id: string; requestNumber: string; custodyBalance: string | null };

function returnSchema(ar: boolean) {
  const required = ar ? "هذا الحقل مطلوب." : "This field is required.";
  return z.object({
    requestId: z.string(),
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ar ? "أدخل تاريخاً صحيحاً." : "Enter a valid date."),
    amount: z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/, ar ? "أدخل مبلغاً موجباً بصيغة صحيحة." : "Enter a valid positive amount."),
    notes: z.string().trim().min(1, required),
  });
}

/** Local validation only; the API applies the custody balance and posting rules. */
export function OperationsCustodyReturnDialog({ open, language, busy, requests, onClose, onSubmit }: {
  open: boolean;
  language: "ar" | "en";
  busy: boolean;
  requests: readonly RequestOption[];
  onClose: () => void;
  onSubmit: (value: CustodyReturnDraft) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = ar ? { title: "تسجيل مرتجع عهدة", request: "ربط بالطلب", date: "التاريخ", amount: "الإجمالي", reason: "سبب المرتجع", select: "اختر", save: "حفظ" } : { title: "Record custody return", request: "Linked request", date: "Date", amount: "Total", reason: "Return reason", select: "Select", save: "Save" };
  const validation = useMemo(() => returnSchema(ar), [ar]);
  const form = useBaseerForm<CustodyReturnDraft>({ defaultValues: { requestId: "", businessDate: new Date().toISOString().slice(0, 10), amount: "", notes: "" }, schema: validation, shouldFocusError: true });
  useEffect(() => { if (open) form.reset({ requestId: "", businessDate: new Date().toISOString().slice(0, 10), amount: "", notes: "" }); }, [form, open]);
  return <BaseerFormDialog open={open} title={text.title} language={language} formId="custody-return" submitLabel={text.save} busy={busy} onClose={onClose}>
    <form id="custody-return" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((value) => void onSubmit(value))}>
      <label>{text.request}<select {...form.register("requestId")}><option value="">{text.select}</option>{requests.map((request) => <option key={request.id} value={request.id}>{request.requestNumber} · {request.custodyBalance}</option>)}</select></label>
      <label>{text.date}<input type="date" aria-invalid={Boolean(form.formState.errors.businessDate)} {...form.register("businessDate")} />{form.formState.errors.businessDate ? <small role="alert">{form.formState.errors.businessDate.message}</small> : null}</label>
      <label>{text.amount}<input inputMode="decimal" aria-invalid={Boolean(form.formState.errors.amount)} {...form.register("amount")} />{form.formState.errors.amount ? <small role="alert">{form.formState.errors.amount.message}</small> : null}</label>
      <label>{text.reason}<input aria-invalid={Boolean(form.formState.errors.notes)} {...form.register("notes")} />{form.formState.errors.notes ? <small role="alert">{form.formState.errors.notes.message}</small> : null}</label>
    </form>
  </BaseerFormDialog>;
}
