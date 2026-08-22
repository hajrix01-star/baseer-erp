import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { financeText } from "./finance-copy";
import type { PaymentMethod, VaultForm } from "./treasury-workspace";

const methodsFor = (type: VaultForm["type"]): PaymentMethod[] => type === "BANK" ? ["BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT"] : [type === "CASH" ? "CASH" : "APP"];
const defaultsFor = (type: VaultForm["type"]): PaymentMethod[] => [methodsFor(type)[0]!];
function schema(ar: boolean) { return z.object({ nameAr: z.string().trim().min(1, ar ? "أدخل اسم الخزينة بالعربية." : "Enter the vault name in Arabic."), nameEn: z.string().trim().min(1, ar ? "أدخل اسم الخزينة بالإنجليزية." : "Enter the vault name in English."), type: z.enum(["CASH", "BANK", "APP"]), paymentMethods: z.array(z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"])).min(1, ar ? "اختر وسيلة دفع واحدة على الأقل." : "Choose at least one payment method."), isSalesChannel: z.boolean(), isPaymentDestination: z.boolean() }); }

/** Vault setup validation only. Transfers, balances, and journal entries stay server-controlled. */
export function TreasuryVaultFormDialog({ open, language, busy, value, editing, onClose, onSubmit }: { open: boolean; language: "ar" | "en"; busy: boolean; value: VaultForm; editing: boolean; onClose: () => void; onSubmit: (value: VaultForm) => Promise<void> | void }) {
  const text = financeText(language);
  const validation = useMemo(() => schema(language === "ar"), [language]);
  const form = useBaseerForm<VaultForm>({ defaultValues: value, schema: validation, shouldFocusError: true });
  const type = form.watch("type"); const isPaymentDestination = form.watch("isPaymentDestination"); const paymentMethods = form.watch("paymentMethods");
  useEffect(() => { if (open) form.reset(value); }, [form, open, value]);
  const options = methodsFor(type);
  const toggle = (method: PaymentMethod) => {
    const next = paymentMethods.includes(method) ? paymentMethods.length > 1 ? paymentMethods.filter((item) => item !== method) : paymentMethods : [...paymentMethods, method];
    form.setValue("paymentMethods", next, { shouldDirty: true, shouldValidate: true });
  };
  const label = (method: PaymentMethod) => method === "CASH" ? text.cash : method === "APP" ? text.app : method === "BANK_TRANSFER" ? text.bankTransfer : method === "BANK_CARD" ? text.bankCard : text.bankPayment;
  return <BaseerDialog open={open} language={language} busy={busy} title={editing ? text.edit : text.addVault} onClose={onClose} footer={<><BaseerButton type="button" onClick={onClose}>{text.cancel}</BaseerButton><BaseerButton type="submit" variant="primary" form="vault-form" disabled={busy}>{busy ? text.saving : editing ? text.save : text.saveVault}</BaseerButton></>}>
    <form id="vault-form" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
      <label>{text.nameArabic}<input autoFocus aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
      <label>{text.nameEnglish}<input aria-invalid={Boolean(form.formState.errors.nameEn)} {...form.register("nameEn")} />{form.formState.errors.nameEn ? <small role="alert">{form.formState.errors.nameEn.message}</small> : null}</label>
      <label>{text.vaultType}<select {...form.register("type")} onChange={(event) => { const next = event.target.value as VaultForm["type"]; form.setValue("type", next, { shouldDirty: true }); form.setValue("paymentMethods", defaultsFor(next), { shouldDirty: true, shouldValidate: true }); }}><option value="CASH">{text.cash}</option><option value="BANK">{text.bank}</option><option value="APP">{text.app}</option></select></label>
      <fieldset><legend>{text.paymentMethod}</legend>{options.map((method) => <label key={method}><input type="checkbox" disabled={!isPaymentDestination} checked={paymentMethods.includes(method)} onChange={() => toggle(method)} /> {label(method)}</label>)}{form.formState.errors.paymentMethods ? <small role="alert">{form.formState.errors.paymentMethods.message}</small> : null}</fieldset>
      <fieldset><legend>{text.vaults}</legend><label><input type="checkbox" {...form.register("isSalesChannel")} /> {text.collectionChannel}</label><label><input type="checkbox" {...form.register("isPaymentDestination")} /> {text.paymentDestination}</label></fieldset>
    </form>
  </BaseerDialog>;
}
