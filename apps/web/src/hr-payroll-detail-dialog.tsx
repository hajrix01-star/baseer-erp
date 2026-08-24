import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerTextArea } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, api, requestId } from "./daily-sales-client";
import { approveHrPayrollRun, discardHrPayrollRun, getHrPayrollRun, payHrPayrollRun, reverseHrPayrollPayment, reverseHrPayrollRun, type HrPayrollDetail, type HrPayment } from "./hr-client";
import { formatNumber } from "./number-format";
import { hasActivePermission } from "./module-access";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP";
type Vault = { id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: PaymentMethod; paymentMethods: PaymentMethod[] };
type Allocation = { vaultId: string; paymentMethod: PaymentMethod | ""; amount: string };
type PayrollPaymentForm = { businessDate: string; allocations: Allocation[] };
type PayrollReversalForm = { reason: string };
type PayrollPaymentReversalForm = { businessDate: string; reason: string };
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string) => formatNumber(value);

export function HrPayrollDetailDialog({ runId, runNumber, language, onClose, onChanged, onError }: { runId: string; runNumber?: string; language: Language; onClose: () => void; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [detail, setDetail] = useState<HrPayrollDetail | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [vaultsLoaded, setVaultsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [paymentToReverse, setPaymentToReverse] = useState<HrPayment | null>(null);
  const dateSchema = useMemo(() => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ar ? "اختر تاريخاً صحيحاً." : "Choose a valid date."), [ar]);
  const paySchema = useMemo(() => z.object({
    businessDate: dateSchema,
    allocations: z.array(z.object({
      vaultId: z.string().min(1, ar ? "اختر الخزينة." : "Choose a vault."),
      paymentMethod: z.string().refine((value): value is PaymentMethod => ["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"].includes(value), ar ? "اختر طريقة السداد." : "Choose a payment method."),
      amount: baseerDecimalString(ar ? "أدخل مبلغاً عشرياً صحيحاً." : "Enter a valid decimal amount."),
    })).min(1, ar ? "أضف توزيع سداد واحداً على الأقل." : "Add at least one payment allocation."),
  }), [ar, dateSchema]);
  const reasonSchema = useMemo(() => z.object({ reason: z.string().trim().min(1, ar ? "أدخل سبب الإلغاء." : "Enter the cancellation reason.") }), [ar]);
  const payForm = useBaseerForm<PayrollPaymentForm>({ schema: paySchema, defaultValues: { businessDate: today(), allocations: [] } });
  const reverseForm = useBaseerForm<PayrollReversalForm>({ schema: reasonSchema, defaultValues: { reason: "" } });
  const paymentReverseForm = useBaseerForm<PayrollPaymentReversalForm>({ schema: useMemo(() => z.object({ businessDate: dateSchema, reason: z.string().trim().min(1, ar ? "أدخل سبب الإلغاء." : "Enter the cancellation reason.") }), [ar, dateSchema]), defaultValues: { businessDate: today(), reason: "" } });
  const payValues = payForm.watch();
  const load = async () => {
    const session = activeSession(); if (!session) return;
    try { setDetail(await getHrPayrollRun(session, runId, { linePageSize: 250, paymentPageSize: 100 })); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "فتح المسير" : "Opening payroll run")); }
  };
  const loadMoreLines = async () => {
    const session = activeSession(); if (!session || !detail?.nextLineCursor || busy) return;
    setBusy(true);
    try { const receipt = await getHrPayrollRun(session, runId, { lineCursor: detail.nextLineCursor, linePageSize: 250, paymentPageSize: 1 }); setDetail((current) => current ? { ...current, lines: [...new Map([...current.lines, ...receipt.lines].map((line) => [line.id, line])).values()], hasMoreLines: receipt.hasMoreLines, nextLineCursor: receipt.nextLineCursor } : current); }
    catch (error) { onError(presentBaseerLoadError(error, language, { ar: "بقية موظفي المسير", en: "more payroll employees" })); }
    finally { setBusy(false); }
  };
  const loadMorePayments = async () => {
    const session = activeSession(); if (!session || !detail?.nextPaymentCursor || busy) return;
    setBusy(true);
    try { const receipt = await getHrPayrollRun(session, runId, { linePageSize: 1, paymentCursor: detail.nextPaymentCursor, paymentPageSize: 100 }); setDetail((current) => current ? { ...current, payments: [...new Map([...current.payments, ...receipt.payments].map((payment) => [payment.id, payment])).values()], hasMorePayments: receipt.hasMorePayments, nextPaymentCursor: receipt.nextPaymentCursor } : current); }
    catch (error) { onError(presentBaseerLoadError(error, language, { ar: "بقية دفعات المسير", en: "more payroll payments" })); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [runId]);
  const activeVaults = useMemo(() => vaults.filter((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination), [vaults]);
  const status = detail?.payrollRun.status;
  const approve = async () => { const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await approveHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate: today(), idempotencyKey: requestId() }); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "اعتماد المسير" : "Approving payroll")); } finally { setBusy(false); } };
  const discard = async () => { const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await discardHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, idempotencyKey: requestId() }); setDiscardOpen(false); await onChanged(); onClose(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "حذف المسودة" : "Discarding payroll draft")); } finally { setBusy(false); } };
  const openPayment = async () => {
    const session = activeSession(); if (!session || busy) return;
    let availableVaults = activeVaults;
    if (!vaultsLoaded) {
      setBusy(true);
      try {
        const configuration = await api<{ vaults: Vault[] }>(session, "/finance/configuration");
        setVaults(configuration.vaults); setVaultsLoaded(true);
        availableVaults = configuration.vaults.filter((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination);
      } catch (error) { onError(presentBaseerLoadError(error, language, { ar: "جهات السداد", en: "payment destinations" })); return; }
      finally { setBusy(false); }
    }
    const vault = availableVaults[0];
    const residual = detail ? String(Number(detail.payrollRun.netPayableAmount) - Number(detail.payrollRun.paidAmount)) : "";
    payForm.reset({ businessDate: today(), allocations: vault ? [{ vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: residual }] : [] }); setPayOpen(true);
  };
  const updateAllocation = (index: number, patch: Partial<Allocation>) => payForm.setValue("allocations", payForm.getValues("allocations").map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item), { shouldDirty: true, shouldValidate: true });
  const pay = async (values: PayrollPaymentForm) => { const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await payHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate: values.businessDate, allocations: values.allocations.map((allocation) => ({ ...allocation, paymentMethod: allocation.paymentMethod || undefined })), idempotencyKey: requestId() }); setPayOpen(false); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "سداد المسير" : "Paying payroll")); } finally { setBusy(false); } };
  const reverse = async (values: PayrollReversalForm) => { const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await reverseHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate: today(), reason: values.reason, idempotencyKey: requestId() }); setReverseOpen(false); reverseForm.reset({ reason: "" }); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر إلغاء المسير." : "The payroll run could not be cancelled.")); } finally { setBusy(false); } };
  const reversePayment = async (values: PayrollPaymentReversalForm) => { const session = activeSession(); if (!session || !paymentToReverse || busy) return; setBusy(true); try { await reverseHrPayrollPayment(session, { payrollPaymentId: paymentToReverse.id, businessDate: values.businessDate, reason: values.reason.trim(), idempotencyKey: requestId() }); setPaymentToReverse(null); paymentReverseForm.reset({ businessDate: today(), reason: "" }); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر إلغاء دفعة المسير." : "The payroll payment could not be cancelled.")); } finally { setBusy(false); } };
  if (!detail) return <BaseerDialog open title={runNumber ?? (ar ? "فتح المسير" : "Opening payroll")} size="wide" className="hr-payroll-create-dialog" language={language} busy={busy} onClose={onClose}><p className="hr-payroll-create__loading-shell" role="status">{ar ? "جارٍ فتح المسير…" : "Opening payroll…"}</p></BaseerDialog>;
  const selectedApplications = (items: Array<{ id: string; amount: string; referenceNumber: string }>) => items.length ? <div className="hr-payroll-create__application-list hr-payroll-detail__applications">{items.map((item) => <label key={item.id} className="is-selected"><input type="checkbox" checked disabled aria-label={item.referenceNumber} /><span>{item.referenceNumber}</span><b dir="ltr">{money(item.amount)}</b></label>)}</div> : "—";
  const paymentColumns = [{ id: "number", header: ar ? "رقم الدفعة" : "Payment no.", cell: (payment: HrPayment) => payment.paymentNumber }, { id: "date", header: ar ? "التاريخ" : "Date", cell: (payment: HrPayment) => payment.businessDate }, { id: "amount", header: ar ? "المبلغ" : "Amount", cell: (payment: HrPayment) => money(payment.amount) }, { id: "status", header: ar ? "الحالة" : "Status", cell: (payment: HrPayment) => payment.status === "POSTED" ? (ar ? "مثبت" : "Posted") : (ar ? "ملغى" : "Cancelled") }, { id: "action", header: ar ? "الإجراء" : "Action", cell: (payment: HrPayment) => hasActivePermission("hr.payroll.reverse") && payment.status === "POSTED" ? <BaseerButton type="button" variant="danger" onClick={() => { paymentReverseForm.reset({ businessDate: today(), reason: "" }); setPaymentToReverse(payment); }}>{ar ? "إلغاء الدفعة" : "Cancel payment"}</BaseerButton> : "—" }];
  const isDraft = status === "DRAFT";
  return <><BaseerDialog open title={detail.payrollRun.runNumber} size="wide" className="hr-payroll-create-dialog" language={language} busy={busy} onClose={onClose} footer={
    <div className="hr-payroll-detail__footer">
      <div className="hr-payroll-create__total"><span>{ar ? "صافي المستحق" : "Net payable"}</span><strong dir="ltr">{money(detail.payrollRun.netPayableAmount)} SAR</strong></div>
      <div className="page-actions">
        <BaseerOutputActions session={activeSession()!} reportCode="hr.payroll-run" language={language} filters={{ payrollRunId: detail.payrollRun.id }} printLabel={ar ? "معاينة وطباعة A4" : "Preview & print A4"} />
        {isDraft ? <BaseerButton type="button" variant="danger" onClick={() => setDiscardOpen(true)}>{ar ? "حذف المسودة" : "Discard draft"}</BaseerButton> : null}
        {isDraft ? <BaseerButton type="button" onClick={() => void approve()}>{ar ? "اعتماد" : "Approve"}</BaseerButton> : null}
        {status === "APPROVED" || status === "PARTIALLY_PAID" ? <BaseerButton type="button" onClick={() => void openPayment()}>{ar ? "سداد" : "Pay"}</BaseerButton> : null}
        {status === "APPROVED" ? <BaseerButton type="button" variant="danger" onClick={() => setReverseOpen(true)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton> : null}
      </div>
    </div>
  }>
    <section className="hr-payroll-detail__draft-table">
      <header><strong>{ar ? `قائمة الموظفين (${detail.lines.length})` : `Employees (${detail.lines.length})`}</strong></header>
      <div className="hr-payroll-create__table-wrap"><table><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "إجمالي الراتب" : "Gross salary"}</th><th>{ar ? "السلف" : "Advances"}</th><th>{ar ? "الخصومات الإدارية" : "Administrative deductions"}</th><th>{ar ? "الصافي المستحق" : "Net payable"}</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td><strong>{line.employeeNumber} · {ar ? line.employeeNameAr : line.employeeNameEn ?? line.employeeNameAr}</strong></td><td><bdi>{money(line.grossSalary)}</bdi></td><td>{selectedApplications(line.advances)}</td><td>{selectedApplications(line.administrativeDeductions)}</td><td><strong dir="ltr">{money(line.netPayableAmount)}</strong></td></tr>)}</tbody></table></div>
      {detail.hasMoreLines ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void loadMoreLines()}>{ar ? "تحميل موظفين إضافيين" : "Load more employees"}</BaseerButton> : null}
      {detail.payments.length ? <BaseerDataGrid ariaLabel={ar ? "دفعات المسير" : "Payroll payments"} caption={ar ? "دفعات المسير" : "Payroll payments"} rows={detail.payments} rowKey={(payment) => payment.id} columns={paymentColumns} /> : null}
      {detail.hasMorePayments ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void loadMorePayments()}>{ar ? "تحميل دفعات إضافية" : "Load more payments"}</BaseerButton> : null}
    </section>
  </BaseerDialog>
    <BaseerConfirmDialog open={discardOpen} language={language} busy={busy} destructive title={ar ? "حذف مسودة المسير" : "Discard payroll draft"} message={ar ? "سيُحذف هذا المسير قبل الاعتماد. لا توجد قيود محاسبية أو مدفوعات مرتبطة به." : "This draft will be deleted before approval. No accounting entries or payments are attached."} confirmLabel={ar ? "حذف المسودة" : "Discard draft"} onCancel={() => setDiscardOpen(false)} onConfirm={() => void discard()} />
    <BaseerFormDialog open={payOpen} title={ar ? "سداد مسير الرواتب" : "Pay payroll run"} language={language} busy={busy} size="standard" formId="hr-payroll-pay-form" submitLabel={ar ? "تسجيل السداد" : "Record payment"} onClose={() => setPayOpen(false)}>
      <form id="hr-payroll-pay-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={payForm.handleSubmit((values) => void pay(values))}>
        <BaseerFormSection title={ar ? "بيانات السداد" : "Payment details"}>
          <BaseerFormGrid columns="one"><BaseerDatePicker language={language} label={ar ? "تاريخ السداد" : "Payment date"} max={today()} value={payValues.businessDate} onChange={(businessDate) => payForm.setValue("businessDate", businessDate, { shouldDirty: true, shouldValidate: true })} />{payForm.formState.errors.businessDate ? <small role="alert">{payForm.formState.errors.businessDate.message}</small> : null}</BaseerFormGrid>
        </BaseerFormSection>
        {payValues.allocations.map((allocation, index) => <BaseerFormSection key={`${allocation.vaultId}-${index}`} title={ar ? `توزيع ${index + 1}` : `Allocation ${index + 1}`}>
          <BaseerFormGrid>
            <label>{ar ? "الخزينة" : "Vault"}<BaseerCombobox required label={ar ? "الخزينة" : "Vault"} value={allocation.vaultId} placeholder={ar ? "اختر الخزينة" : "Select vault"} options={activeVaults.map((vault) => ({ id: vault.id, label: ar ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => { const vault = vaults.find((item) => item.id === vaultId); updateAllocation(index, { vaultId, paymentMethod: vault?.paymentMethod ?? "" }); }} />{payForm.formState.errors.allocations?.[index]?.vaultId ? <small role="alert">{payForm.formState.errors.allocations[index]?.vaultId?.message}</small> : null}</label>
            <label>{ar ? "طريقة السداد" : "Payment method"}<BaseerCombobox searchable={false} required label={ar ? "طريقة السداد" : "Payment method"} value={allocation.paymentMethod} placeholder={ar ? "اختر الطريقة" : "Select method"} options={(vaults.find((vault) => vault.id === allocation.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => updateAllocation(index, { paymentMethod: paymentMethod as PaymentMethod })} />{payForm.formState.errors.allocations?.[index]?.paymentMethod ? <small role="alert">{payForm.formState.errors.allocations[index]?.paymentMethod?.message}</small> : null}</label>
            <label className="baseer-form-field--full">{ar ? "المبلغ" : "Amount"}<BaseerMoneyInput required aria-invalid={payForm.formState.errors.allocations?.[index]?.amount ? "true" : undefined} aria-describedby={payForm.formState.errors.allocations?.[index]?.amount ? `hr-payroll-allocation-${index}-amount-error` : undefined} value={allocation.amount} onValueChange={(amount) => updateAllocation(index, { amount })} />{payForm.formState.errors.allocations?.[index]?.amount ? <small id={`hr-payroll-allocation-${index}-amount-error`} role="alert">{payForm.formState.errors.allocations[index]?.amount?.message}</small> : null}</label>
            {payValues.allocations.length > 1 ? <BaseerButton type="button" variant="quiet" onClick={() => payForm.setValue("allocations", payForm.getValues("allocations").filter((_, itemIndex) => itemIndex !== index), { shouldDirty: true, shouldValidate: true })}>{ar ? "إزالة هذا التوزيع" : "Remove this allocation"}</BaseerButton> : null}
          </BaseerFormGrid>
        </BaseerFormSection>)}
        {payForm.formState.errors.allocations?.message ? <small role="alert">{payForm.formState.errors.allocations.message}</small> : null}
        <BaseerButton type="button" variant="secondary" onClick={() => { const allocations = payForm.getValues("allocations"); const vault = activeVaults.find((item) => !allocations.some((allocation) => allocation.vaultId === item.id)) ?? activeVaults[0]; if (vault) payForm.setValue("allocations", [...allocations, { vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: "" }], { shouldDirty: true, shouldValidate: true }); }}>{ar ? "إضافة خزينة" : "Add vault"}</BaseerButton>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={reverseOpen} title={ar ? "إلغاء مسير الرواتب" : "Cancel payroll run"} language={language} busy={busy} size="compact" formId="hr-payroll-reverse-form" submitLabel={ar ? "إلغاء" : "Cancel"} onClose={() => setReverseOpen(false)}>
      <form id="hr-payroll-reverse-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={reverseForm.handleSubmit((values) => void reverse(values))}><BaseerFormSection title={ar ? "سبب الإلغاء" : "Cancellation reason"}><BaseerFormGrid columns="one"><label>{ar ? "سبب الإلغاء" : "Cancellation reason"}<BaseerTextArea compact required aria-invalid={reverseForm.formState.errors.reason ? "true" : undefined} aria-describedby={reverseForm.formState.errors.reason ? "hr-payroll-reverse-reason-error" : undefined} value={reverseForm.watch("reason")} onValueChange={(reason) => reverseForm.setValue("reason", reason, { shouldDirty: true, shouldValidate: true })} />{reverseForm.formState.errors.reason ? <small id="hr-payroll-reverse-reason-error" role="alert">{reverseForm.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form>
    </BaseerFormDialog>
    <BaseerFormDialog open={Boolean(paymentToReverse)} title={ar ? "إلغاء دفعة المسير" : "Cancel payroll payment"} language={language} busy={busy} size="compact" formId="hr-payroll-payment-reverse-form" submitLabel={ar ? "إلغاء" : "Cancel"} onClose={() => setPaymentToReverse(null)}><form id="hr-payroll-payment-reverse-form" className="baseer-form" data-baseer-rhf-form="true" noValidate onSubmit={paymentReverseForm.handleSubmit((values) => void reversePayment(values))}><BaseerFormSection title={paymentToReverse?.paymentNumber ?? ""}><BaseerFormGrid columns="one"><BaseerDatePicker language={language} label={ar ? "تاريخ الإلغاء" : "Cancellation date"} max={today()} value={paymentReverseForm.watch("businessDate")} onChange={(businessDate) => paymentReverseForm.setValue("businessDate", businessDate, { shouldDirty: true, shouldValidate: true })} />{paymentReverseForm.formState.errors.businessDate ? <small role="alert">{paymentReverseForm.formState.errors.businessDate.message}</small> : null}<label>{ar ? "سبب الإلغاء" : "Cancellation reason"}<BaseerTextArea compact required aria-invalid={paymentReverseForm.formState.errors.reason ? "true" : undefined} aria-describedby={paymentReverseForm.formState.errors.reason ? "hr-payroll-payment-reverse-reason-error" : undefined} value={paymentReverseForm.watch("reason")} onValueChange={(reason) => paymentReverseForm.setValue("reason", reason, { shouldDirty: true, shouldValidate: true })} />{paymentReverseForm.formState.errors.reason ? <small id="hr-payroll-payment-reverse-reason-error" role="alert">{paymentReverseForm.formState.errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
  </>;
}
