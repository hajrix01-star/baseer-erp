import { useBaseerForm, z } from "./baseer-form-state";
import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { formatMoney } from "./number-format";
import type { OperationsPurchasePosLine } from "./operations-purchase-pos-composer";

const LazyOperationsPurchasePosComposer = lazy(async () => ({ default: (await import("./operations-purchase-pos-composer")).OperationsPurchasePosComposer }));
const OperationsPurchasePosComposer = LazyOperationsPurchasePosComposer as unknown as typeof import("./operations-purchase-pos-composer").OperationsPurchasePosComposer;

type Language = "ar" | "en";
type PaymentChannel = "CUSTODY" | "CASH" | "BANK_TRANSFER";
type Unit = { id: string; nameAr: string; nameEn: string | null; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" };
type Item = { id: string; nameAr: string; nameEn: string | null; kind: "RAW_MATERIAL" | "MENU_PRODUCT"; status: "ACTIVE" | "ARCHIVED"; itemUnits: Array<{ unitId: string; isActive: boolean; isOrderEnabled: boolean; lastPurchaseUnitPrice: string | null }> };
type RequestLine = { id: string; rawMaterialItemId: string; requestedUnitId: string; requestedQuantity: string; quotedUnitPrice: string; quotedLineTotal: string };
type PurchaseRequest = { id: string; requestNumber: string; plannedPaymentChannel: PaymentChannel; status: "PENDING_RECEIPT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED" | "REVERSED"; lines: RequestLine[]; receipts: Array<{ status: "POSTED" | "REVERSED"; lines: Array<{ requestLineId: string | null; receivedQuantity: string }> }> };
type ReceiptInput = { requestLineId: string | null; rawMaterialItemId: string; unitId: string; quantity: string; price: string; selected: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number, language: Language) => formatMoney(value, "SAR", language);

function formSchema(language: Language) {
  const ar = language === "ar";
  return z.object({
    businessDate: z.string().min(1, ar ? "التاريخ مطلوب." : "Date is required."),
    requestId: z.string().min(1, ar ? "اختر طلب الشراء أولاً." : "Select a purchase request first."),
    notes: z.string(),
    paymentReference: z.string(),
  });
}
type FormValues = z.infer<ReturnType<typeof formSchema>>;

export function OperationsPurchaseCompletionDialog({ open, language, busy, requests, materials, units, initialRequestId, onClose, onSubmit }: {
  open: boolean;
  language: Language;
  busy: boolean;
  requests: PurchaseRequest[];
  materials: Item[];
  units: Unit[];
  initialRequestId: string;
  onClose: () => void;
  onSubmit: (value: { requestId: string; businessDate: string; notes?: string; paymentReference?: string; lines: Array<{ requestLineId?: string; rawMaterialItemId: string; receivedUnitId: string; receivedQuantity: string; actualUnitPrice: string }> }) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = ar ? { title: "اعتماد الشراء الفعلي", submit: "اعتماد", date: "التاريخ", channel: "قناة الدفع التشغيلية", custody: "عهدة المندوب", cash: "نقدي محلي", transfer: "تحويل بنكي", reference: "مرجع التحويل الفعلي", request: "الطلب", select: "اختر", notes: "ملاحظات", loading: "جارٍ تحميل البنود…", noLines: "أضف بند شراء واحداً على الأقل قبل الاعتماد.", total: "الإجمالي", confirmation: "سيتم تحديث المخزون والتكلفة والعهدة مرة واحدة عند الاعتماد." } : { title: "Confirm actual purchase", submit: "Confirm", date: "Date", channel: "Operational payment channel", custody: "Representative custody", cash: "Local cash", transfer: "Bank transfer", reference: "Actual transfer reference", request: "Request", select: "Select", notes: "Notes", loading: "Loading lines…", noLines: "Add at least one purchase line before confirming.", total: "Total", confirmation: "Inventory, cost, and custody will update once when confirmed." };
  const form = useBaseerForm<FormValues>({ schema: formSchema(language), defaultValues: { businessDate: today(), requestId: "", notes: "", paymentReference: "" } });
  const [lines, setLines] = useState<ReceiptInput[]>([]);
  const requestId = form.watch("requestId");
  const businessDate = form.watch("businessDate");
  const selectedRequest = requests.find((request) => request.id === requestId);

  const receivedBefore = (request: PurchaseRequest, line: RequestLine) => request.receipts.filter((receipt) => receipt.status === "POSTED").flatMap((receipt) => receipt.lines).filter((receiptLine) => receiptLine.requestLineId === line.id).reduce((sum, receiptLine) => sum + Number(receiptLine.receivedQuantity), 0);
  const chooseRequest = (id: string) => {
    const request = requests.find((entry) => entry.id === id);
    form.setValue("requestId", id, { shouldValidate: true });
    form.setValue("paymentReference", "");
    setLines(request?.lines.map((line) => { const remaining = Math.max(0, Number(line.requestedQuantity) - receivedBefore(request, line)); return { requestLineId: line.id, rawMaterialItemId: line.rawMaterialItemId, unitId: line.requestedUnitId, quantity: String(remaining), price: line.quotedUnitPrice, selected: remaining > 0 }; }) ?? []);
  };
  useEffect(() => {
    if (!open) return;
    form.reset({ businessDate: today(), requestId: "", notes: "", paymentReference: "" });
    chooseRequest(initialRequestId || requests[0]?.id || "");
    // The request list is only used to establish the opening values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRequestId]);

  const composerLines = lines.filter((line) => line.selected).map(({ rawMaterialItemId, unitId, quantity, price }) => ({ rawMaterialItemId, unitId, quantity, price }));
  const updateComposer = (next: OperationsPurchasePosLine[]) => setLines(next.map((line) => { const existing = lines.find((entry) => entry.selected && entry.rawMaterialItemId === line.rawMaterialItemId); const planned = selectedRequest?.lines.find((entry) => entry.rawMaterialItemId === line.rawMaterialItemId); return { requestLineId: existing?.requestLineId ?? planned?.id ?? null, rawMaterialItemId: line.rawMaterialItemId, unitId: line.unitId, quantity: line.quantity, price: line.price ?? "", selected: true }; }));
  const total = lines.filter((line) => line.selected).reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.price || 0), 0);
  const submit = form.handleSubmit(async (value) => {
    const confirmedLines = lines.filter((line) => line.selected);
    if (!confirmedLines.length) { form.setError("root", { message: text.noLines }); return; }
    if (selectedRequest?.plannedPaymentChannel === "BANK_TRANSFER" && !value.paymentReference.trim()) { form.setError("paymentReference", { message: ar ? "مرجع التحويل مطلوب." : "A transfer reference is required." }); return; }
    await onSubmit({ requestId: value.requestId, businessDate: value.businessDate, notes: value.notes.trim() || undefined, paymentReference: value.paymentReference.trim() || undefined, lines: confirmedLines.map((line) => ({ requestLineId: line.requestLineId ?? undefined, rawMaterialItemId: line.rawMaterialItemId, receivedUnitId: line.unitId, receivedQuantity: line.quantity, actualUnitPrice: line.price })) });
  });

  return <BaseerFormDialog open={open} title={text.title} language={language} formId="purchase-completion" submitLabel={`${text.submit} · ${money(total, language)}`} busy={busy} onClose={onClose}><form id="purchase-completion" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={(event) => void submit(event)}>
    <div className="operations-purchase-request-meta"><label>{text.date}<BaseerDatePicker language={language} label={text.date} value={businessDate} onChange={(value) => form.setValue("businessDate", value, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.businessDate ? <small role="alert">{form.formState.errors.businessDate.message}</small> : null}</label><fieldset className="operations-payment-channel"><legend>{text.channel}</legend><div><BaseerButton type="button" variant="primary" disabled>{selectedRequest?.plannedPaymentChannel === "CUSTODY" ? text.custody : selectedRequest?.plannedPaymentChannel === "BANK_TRANSFER" ? text.transfer : text.cash}</BaseerButton></div></fieldset><label>{text.request}<select aria-invalid={Boolean(form.formState.errors.requestId)} value={requestId} onChange={(event) => chooseRequest(event.target.value)}><option value="">{text.select}</option>{requests.map((request) => <option key={request.id} value={request.id}>{request.requestNumber}</option>)}</select>{form.formState.errors.requestId ? <small role="alert">{form.formState.errors.requestId.message}</small> : null}</label>{selectedRequest?.plannedPaymentChannel === "BANK_TRANSFER" ? <label>{text.reference}<input aria-invalid={Boolean(form.formState.errors.paymentReference)} {...form.register("paymentReference")} />{form.formState.errors.paymentReference ? <small role="alert">{form.formState.errors.paymentReference.message}</small> : null}</label> : null}</div><label>{text.notes}<input {...form.register("notes")} /></label><Suspense fallback={<p>{text.loading}</p>}><OperationsPurchasePosComposer language={language} materials={materials} units={units} lines={composerLines} onChange={updateComposer} /></Suspense>{form.formState.errors.root ? <small role="alert">{form.formState.errors.root.message}</small> : null}<p>{text.confirmation}</p></form></BaseerFormDialog>;
}
