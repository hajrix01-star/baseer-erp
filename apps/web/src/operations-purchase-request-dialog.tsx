import { useBaseerForm, z } from "./baseer-form-state";
import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerTextInput } from "./baseer-form-fields";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { normalizeBaseerNumericInput } from "./number-format";
import type { OperationsPurchasePosLine } from "./operations-purchase-pos-composer";
import "./operations-purchase-dialog.css";

const LazyOperationsPurchasePosComposer = lazy(async () => ({ default: (await import("./operations-purchase-pos-composer")).OperationsPurchasePosComposer }));
const OperationsPurchasePosComposer = LazyOperationsPurchasePosComposer as unknown as typeof import("./operations-purchase-pos-composer").OperationsPurchasePosComposer;

type Language = "ar" | "en";
type PaymentChannel = "CUSTODY" | "CASH" | "BANK_TRANSFER";
type Unit = { id: string; nameAr: string; nameEn: string | null; dimension: "COUNT" | "MASS" | "VOLUME" | "PACKAGE" };
type Item = { id: string; nameAr: string; nameEn: string | null; kind: "RAW_MATERIAL" | "MENU_PRODUCT"; status: "ACTIVE" | "ARCHIVED"; itemUnits: Array<{ unitId: string; isActive: boolean; isOrderEnabled: boolean; lastPurchaseUnitPrice: string | null }> };

const decimal = /^\d+(?:\.\d{1,4})?$/;

function schema(language: Language) {
  const ar = language === "ar";
  return z.object({
    businessDate: z.string().min(1, ar ? "التاريخ مطلوب." : "Date is required."),
    paymentChannel: z.enum(["CUSTODY", "CASH", "BANK_TRANSFER"]),
    custodyFundingAmount: z.string(),
    representativeName: z.string(),
    notes: z.string(),
  }).superRefine((value, context) => {
    if (value.paymentChannel !== "CUSTODY") return;
    if (!decimal.test(value.custodyFundingAmount) || Number(value.custodyFundingAmount) <= 0) {
      context.addIssue({ code: "custom", path: ["custodyFundingAmount"], message: ar ? "أدخل مبلغ عهدة صحيحاً أكبر من صفر." : "Enter a custody amount greater than zero." });
    }
    if (!value.representativeName.trim()) {
      context.addIssue({ code: "custom", path: ["representativeName"], message: ar ? "اسم المندوب مطلوب للعهدة." : "A representative is required for custody." });
    }
  });
}

type FormValues = z.infer<ReturnType<typeof schema>>;

export function OperationsPurchaseRequestDialog({ open, language, busy, materials, units, defaultRepresentative, onClose, onSubmit }: {
  open: boolean;
  language: Language;
  busy: boolean;
  materials: Item[];
  units: Unit[];
  defaultRepresentative: string;
  onClose: () => void;
  onSubmit: (value: { businessDate: string; paymentChannel: PaymentChannel; custodyFundingAmount?: string; representativeName?: string; notes?: string; lines: Array<{ rawMaterialItemId: string; requestedUnitId: string; requestedQuantity: string; quotedUnitPrice: string }> }) => Promise<void> | void;
}) {
  const ar = language === "ar";
  const text = ar ? { title: "إنشاء طلب شراء", review: "حفظ خطة الطلب", date: "التاريخ", channel: "قناة الدفع التشغيلية", custody: "عهدة المندوب", cash: "نقدي محلي", transfer: "تحويل بنكي", funding: "العهدة المسلّمة", representative: "اسم المندوب", notes: "ملاحظات", loading: "جارٍ تحميل البنود…", lines: "أضف مادة واحدة على الأقل قبل الحفظ.", plan: "هذه خطة تقديرية فقط. اعتماد الشراء الفعلي هو الذي يحدّث المخزون والتكلفة والعهدة." } : { title: "Create purchase request", review: "Save request plan", date: "Date", channel: "Operational payment channel", custody: "Representative custody", cash: "Local cash", transfer: "Bank transfer", funding: "Custody funding", representative: "Representative name", notes: "Notes", loading: "Loading lines…", lines: "Add at least one material before saving.", plan: "This is an estimate only. Confirming the actual purchase updates inventory, cost, and custody." };
  // A purchase plan must be dated deliberately.  The API independently
  // requires YYYY-MM-DD, so an omitted date cannot become a financial event.
  const form = useBaseerForm<FormValues>({ schema: schema(language), defaultValues: { businessDate: "", paymentChannel: "CASH", custodyFundingAmount: "", representativeName: "", notes: "" } });
  const [lines, setLines] = useState<OperationsPurchasePosLine[]>([]);
  const channel = form.watch("paymentChannel");
  const businessDate = form.watch("businessDate");
  const custodyFundingAmount = form.watch("custodyFundingAmount");

  useEffect(() => {
    if (!open) return;
    form.reset({ businessDate: "", paymentChannel: "CASH", custodyFundingAmount: "", representativeName: defaultRepresentative, notes: "" });
    setLines([]);
  }, [defaultRepresentative, form, open]);

  const submit = form.handleSubmit(async (value) => {
    if (!lines.length) {
      form.setError("root", { message: text.lines });
      return;
    }
    await onSubmit({
      businessDate: value.businessDate,
      paymentChannel: value.paymentChannel,
      custodyFundingAmount: value.paymentChannel === "CUSTODY" ? value.custodyFundingAmount : undefined,
      representativeName: value.paymentChannel === "CUSTODY" ? value.representativeName.trim() : undefined,
      notes: value.notes.trim() || undefined,
      lines: lines.map((line) => ({ rawMaterialItemId: line.rawMaterialItemId, requestedUnitId: line.unitId, requestedQuantity: line.quantity, quotedUnitPrice: line.price ?? "" })),
    });
  });

  return <BaseerFormDialog open={open} title={text.title} language={language} formId="purchase-request" submitLabel={text.review} busy={busy} onClose={onClose}>
    <form id="purchase-request" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={(event) => void submit(event)}>
      <div className="operations-purchase-request-meta">
        <label>{text.date}<BaseerDatePicker language={language} label={text.date} value={businessDate} onChange={(value) => form.setValue("businessDate", value, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.businessDate ? <small role="alert">{form.formState.errors.businessDate.message}</small> : null}</label>
        <fieldset className="operations-payment-channel"><legend>{text.channel}</legend><div>
          <BaseerButton type="button" variant={channel === "CASH" ? "primary" : "secondary"} onClick={() => form.setValue("paymentChannel", "CASH", { shouldValidate: true })}>{text.cash}</BaseerButton>
          <BaseerButton type="button" variant={channel === "BANK_TRANSFER" ? "primary" : "secondary"} onClick={() => form.setValue("paymentChannel", "BANK_TRANSFER", { shouldValidate: true })}>{text.transfer}</BaseerButton>
          <BaseerButton type="button" variant={channel === "CUSTODY" ? "primary" : "secondary"} onClick={() => form.setValue("paymentChannel", "CUSTODY", { shouldValidate: true })}>{text.custody}</BaseerButton>
        </div></fieldset>
        {channel === "CUSTODY" ? <><label>{text.funding}<input aria-invalid={Boolean(form.formState.errors.custodyFundingAmount)} inputMode="decimal" dir="ltr" lang="en" value={custodyFundingAmount} onChange={(event) => form.setValue("custodyFundingAmount", normalizeBaseerNumericInput(event.target.value), { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.custodyFundingAmount ? <small role="alert">{form.formState.errors.custodyFundingAmount.message}</small> : null}</label><label>{text.representative}<BaseerTextInput aria-invalid={Boolean(form.formState.errors.representativeName)} {...form.register("representativeName")} />{form.formState.errors.representativeName ? <small role="alert">{form.formState.errors.representativeName.message}</small> : null}</label></> : null}
      </div>
      <label>{text.notes}<BaseerTextInput {...form.register("notes")} /></label>
      <Suspense fallback={<p>{text.loading}</p>}><OperationsPurchasePosComposer language={language} materials={materials} units={units} lines={lines} onChange={setLines} /></Suspense>
      {form.formState.errors.root ? <small role="alert">{form.formState.errors.root.message}</small> : null}
      <p>{text.plan}</p>
    </form>
  </BaseerFormDialog>;
}
