import { useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerCheckbox, BaseerMoneyInput, BaseerTextInput } from "./baseer-form-fields";
import { BaseerStaticSelect } from "./baseer-static-select";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import type { ProfileForm, RecurringExpenseConfiguration } from "./recurring-expense-workspace";

const emptyProfile = (businessDate: string): ProfileForm => ({ nameAr: "", nameEn: "", categoryId: "", supplierId: "", serviceNumber: "", expectedAmount: "", intervalMonths: "1", nextReminderDate: businessDate, defaultVaultId: "", allowAmountOverride: true, notes: "" });
function schema(ar: boolean) {
  return z.object({
    nameAr: z.string().trim().min(1, ar ? "أدخل اسم الالتزام بالعربية." : "Enter the recurring expense name in Arabic."),
    nameEn: z.string(), categoryId: z.string().min(1, ar ? "اختر الفئة المالية." : "Choose a financial category."), supplierId: z.string(), serviceNumber: z.string(),
    expectedAmount: z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/, ar ? "أدخل مبلغاً صحيحاً." : "Enter a valid amount."),
    intervalMonths: z.enum(["1", "2", "3", "4", "6", "12"]), nextReminderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), defaultVaultId: z.string(), allowAmountOverride: z.boolean(), notes: z.string(),
  });
}

/** Local profile validation; creating and scheduling the financial obligation remains an API command. */
export function RecurringExpenseProfileDialog({ open, language, busy, configuration, businessDate, onClose, onSubmit }: { open: boolean; language: "ar" | "en"; busy: boolean; configuration: RecurringExpenseConfiguration; businessDate: string; onClose: () => void; onSubmit: (value: ProfileForm) => Promise<void> | void }) {
  const text = financeText(language);
  const validation = useMemo(() => schema(language === "ar"), [language]);
  const form = useBaseerForm<ProfileForm>({ defaultValues: emptyProfile(businessDate), schema: validation, shouldFocusError: true });
  const selectedCategory = form.watch("categoryId");
  const selectedSupplier = form.watch("supplierId");
  const selectedVault = form.watch("defaultVaultId");
  const nextReminderDate = form.watch("nextReminderDate");
  const allowAmountOverride = form.watch("allowAmountOverride");
  const categories = configuration.categories.filter((item) => item.status === "ACTIVE" && item.kind === "EXPENSE");
  const suppliers = configuration.suppliers.filter((item) => item.status === "ACTIVE");
  const vaults = configuration.vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination);
  useEffect(() => { if (open) form.reset(emptyProfile(businessDate)); }, [businessDate, form, open]);
  return <BaseerDialog open={open} title={text.addRecurring} language={language} busy={busy} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{text.cancel}</BaseerButton><BaseerButton type="submit" form="recurring-profile-form" variant="primary" disabled={busy}>{busy ? text.saving : text.saveRecurring}</BaseerButton></>}>
    <form id="recurring-profile-form" className="administration-form" data-baseer-rhf-form="true" noValidate onSubmit={form.handleSubmit((next) => void onSubmit(next))}>
      <label>{text.nameArabic}<BaseerTextInput autoFocus placeholder={language === "ar" ? "كهرباء الفرع" : "Branch electricity"} aria-invalid={Boolean(form.formState.errors.nameAr)} {...form.register("nameAr")} />{form.formState.errors.nameAr ? <small role="alert">{form.formState.errors.nameAr.message}</small> : null}</label>
      <label>{text.nameEnglish}<BaseerTextInput placeholder="Branch electricity" {...form.register("nameEn")} /></label>
      <label>{text.financialCategory}<BaseerCombobox required label={text.financialCategory} value={selectedCategory} placeholder={text.selectCategory} options={categories.map((item) => ({ id: item.id, label: displayName(language, item) }))} invalid={Boolean(form.formState.errors.categoryId)} onChange={(categoryId) => { form.setValue("categoryId", categoryId, { shouldDirty: true, shouldValidate: true }); const category = categories.find((item) => item.id === categoryId); form.setValue("supplierId", category?.suggestedSupplierId ?? "", { shouldDirty: true, shouldValidate: true }); }} />{form.formState.errors.categoryId ? <small role="alert">{form.formState.errors.categoryId.message}</small> : null}</label>
      <label>{text.supplier}<BaseerCombobox label={text.supplier} value={selectedSupplier} placeholder={text.optional} options={suppliers.map((item) => ({ id: item.id, label: displayName(language, item) }))} onChange={(supplierId) => form.setValue("supplierId", supplierId, { shouldDirty: true, shouldValidate: true })} /></label>
      <label>{text.serviceNumber}<BaseerTextInput placeholder={text.optional} {...form.register("serviceNumber")} /></label>
      <label>{text.expectedAmount} (SAR)<BaseerMoneyInput placeholder={text.enterAmount} aria-invalid={Boolean(form.formState.errors.expectedAmount)} value={form.watch("expectedAmount")} onValueChange={(expectedAmount) => form.setValue("expectedAmount", expectedAmount, { shouldDirty: true, shouldValidate: true })} />{form.formState.errors.expectedAmount ? <small role="alert">{form.formState.errors.expectedAmount.message}</small> : null}</label>
      <label>{text.paymentCycle}<BaseerStaticSelect label={text.paymentCycle} {...form.register("intervalMonths")}>{[1, 2, 3, 4, 6, 12].map((month) => <option key={month} value={month}>{month === 1 ? text.monthly : text.everyMonths(month)}</option>)}</BaseerStaticSelect></label>
      <label>{text.nextDueDate}<BaseerDatePicker language={language} label={text.nextDueDate} value={nextReminderDate} onChange={(value) => form.setValue("nextReminderDate", value, { shouldDirty: true, shouldValidate: true })} /></label>
      <label>{text.defaultPaymentChannel}<BaseerCombobox label={text.defaultPaymentChannel} value={selectedVault} placeholder={text.setAtPayment} options={vaults.map((item) => ({ id: item.id, label: displayName(language, item) }))} onChange={(defaultVaultId) => form.setValue("defaultVaultId", defaultVaultId, { shouldDirty: true, shouldValidate: true })} /></label>
      <label><BaseerCheckbox {...form.register("allowAmountOverride")} /> {allowAmountOverride ? text.allowAmountOverride : text.allowAmountOverride}</label>
      <label style={{ gridColumn: "1 / -1" }}>{text.notes}<BaseerTextInput placeholder={text.optional} {...form.register("notes")} /></label>
    </form>
  </BaseerDialog>;
}
