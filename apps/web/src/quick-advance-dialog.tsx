import { useEffect, useMemo, useState } from "react";

import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerTextArea } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { activeSession, requestId, type ActiveSession } from "./daily-sales-client";
import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { getHrAdvanceEntryReferences, issueHrEmployeeAdvance, type HrAdvanceEntryReferences } from "./hr-client";

type Language = "ar" | "en";
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP" | "";
type QuickAdvanceForm = { employeeId: string; businessDate: string; amount: string; vaultId: string; paymentMethod: PaymentMethod; notes: string };
type AdvanceEntryReferences = HrAdvanceEntryReferences;

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = (vault?: AdvanceEntryReferences["vaults"][number]): QuickAdvanceForm => ({ employeeId: "", businessDate: today(), amount: "", vaultId: vault?.id ?? "", paymentMethod: vault?.paymentMethod || vault?.paymentMethods[0] || "", notes: "" });

/** A global, permission-gated shortcut that uses the same authorized HR endpoint as the full register. */
export function QuickAdvanceDialog({ open, language, onClose }: { open: boolean; language: Language; onClose: () => void }) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [references, setReferences] = useState<AdvanceEntryReferences | null>(null);
  const [form, setForm] = useState<QuickAdvanceForm>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = language === "ar"
    ? { title: "إدخال سلفة", save: "حفظ السلفة", employee: "الموظف", date: "تاريخ السلفة", amount: "المبلغ", vault: "الخزينة", method: "طريقة الصرف", notes: "ملاحظات", details: "بيانات السلفة", source: "مصدر الصرف", loading: "جارٍ تجهيز بيانات السلفة…", loadFailed: "تعذر تجهيز بيانات السلفة. أعد المحاولة.", saveFailed: "تعذر حفظ السلفة. أعد المحاولة.", invalidAmount: "أدخل مبلغاً صحيحاً أكبر من صفر.", required: "هذا الحقل مطلوب." }
    : { title: "Enter advance", save: "Save advance", employee: "Employee", date: "Advance date", amount: "Amount", vault: "Vault", method: "Payment method", notes: "Notes", details: "Advance details", source: "Payment source", loading: "Preparing advance details…", loadFailed: "Could not prepare advance details. Try again.", saveFailed: "Could not save the advance. Try again.", invalidAmount: "Enter a valid amount greater than zero.", required: "This field is required." };
  const schema = useMemo(() => {
    const amount = baseerDecimalString(copy.invalidAmount, 4, 14).refine((value) => !/^0+(?:\.0+)?$/.test(value), copy.invalidAmount);
    return z.object({ employeeId: z.string().min(1, copy.required), businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, copy.required), amount, vaultId: z.string().min(1, copy.required), paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]), notes: z.string() });
  }, [copy.invalidAmount, copy.required]);
  const formState = useBaseerForm<QuickAdvanceForm>({ schema, values: form });

  useEffect(() => {
    if (!open) return;
    const current = activeSession();
    setSession(current);
    setError(null);
    if (!current) return;
    let cancelled = false;
    setLoading(true);
    void getHrAdvanceEntryReferences(current)
      .then((nextReferences) => {
        if (cancelled) return;
        setReferences(nextReferences);
        setForm(emptyForm(nextReferences.vaults[0]));
      })
      .catch((cause: unknown) => { if (!cancelled) setError(presentBaseerLoadError(cause, language, { ar: "بيانات السلفة", en: "advance details" })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [language, open]);

  const employees = references?.employees ?? [];
  const activeVaults = references?.vaults ?? [];
  const selectedVault = activeVaults.find((vault) => vault.id === form.vaultId);
  const save = async () => {
    if (!session || saving) return;
    setSaving(true);
    setError(null);
    try {
      await issueHrEmployeeAdvance(session, { employeeId: form.employeeId, businessDate: form.businessDate, amount: form.amount, notes: form.notes || undefined, allocations: [{ vaultId: form.vaultId, amount: form.amount, paymentMethod: form.paymentMethod }], idempotencyKey: requestId() });
      onClose();
    } catch (cause) {
      setError(presentBaseerApiError(cause, language, copy.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  return <BaseerFormDialog open={open} title={copy.title} language={language} busy={loading || saving} error={error} size="standard" formId="quick-advance-form" submitLabel={copy.save} submitDisabled={loading || !session} onClose={onClose}>
    <form id="quick-advance-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={formState.handleSubmit(() => void save())}>
      <BaseerFormSection title={copy.details}>
        <BaseerFormGrid>
          <label className="baseer-form-field baseer-form-field--full">{copy.employee}<BaseerCombobox required label={copy.employee} value={form.employeeId} placeholder={copy.employee} options={employees.map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}` }))} scopeKey={session?.companyId ?? "signed-out"} onChange={(employeeId) => setForm((current) => ({ ...current, employeeId }))} />{formState.formState.errors.employeeId ? <small role="alert">{formState.formState.errors.employeeId.message}</small> : null}</label>
          <label className="baseer-form-field">{copy.date}<BaseerDatePicker language={language} label={copy.date} max={today()} value={form.businessDate} onChange={(businessDate) => setForm((current) => ({ ...current, businessDate }))} /></label>
          <label className="baseer-form-field">{copy.amount}<BaseerMoneyInput required value={form.amount} onValueChange={(amount) => setForm((current) => ({ ...current, amount }))} />{formState.formState.errors.amount ? <small role="alert">{formState.formState.errors.amount.message}</small> : null}</label>
        </BaseerFormGrid>
      </BaseerFormSection>
      <BaseerFormSection title={copy.source}>
        <BaseerFormGrid>
          <label className="baseer-form-field">{copy.vault}<BaseerCombobox required label={copy.vault} value={form.vaultId} placeholder={copy.vault} options={activeVaults.map((vault) => ({ id: vault.id, label: language === "ar" ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => { const vault = activeVaults.find((item) => item.id === vaultId); setForm((current) => ({ ...current, vaultId, paymentMethod: vault?.paymentMethod || vault?.paymentMethods[0] || "" })); }} />{formState.formState.errors.vaultId ? <small role="alert">{formState.formState.errors.vaultId.message}</small> : null}</label>
          <label className="baseer-form-field">{copy.method}<BaseerCombobox searchable={false} required label={copy.method} value={form.paymentMethod} placeholder={copy.method} options={(selectedVault?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => setForm((current) => ({ ...current, paymentMethod: paymentMethod as PaymentMethod }))} />{formState.formState.errors.paymentMethod ? <small role="alert">{formState.formState.errors.paymentMethod.message}</small> : null}</label>
          <label className="baseer-form-field baseer-form-field--full">{copy.notes}<BaseerTextArea compact value={form.notes} onValueChange={(notes) => setForm((current) => ({ ...current, notes }))} /></label>
        </BaseerFormGrid>
      </BaseerFormSection>
    </form>
  </BaseerFormDialog>;
}
