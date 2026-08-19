import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerTextArea } from "./baseer-form-fields";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerSearchSelect } from "./baseer-search-select";
import { DataTable } from "./data-table";
import { activeSession, api, requestId } from "./daily-sales-client";
import { approveHrPayrollRun, discardHrPayrollRun, getHrPayrollRun, payHrPayrollRun, reverseHrPayrollPayment, reverseHrPayrollRun, type HrPayrollDetail, type HrPayment } from "./hr-client";
import { formatNumber } from "./number-format";
import { hasActivePermission } from "./module-access";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";
type PaymentMethod = "CASH" | "BANK_TRANSFER" | "BANK_CARD" | "BANK_PAYMENT" | "APP";
type Vault = { id: string; nameAr: string; nameEn: string; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean; paymentMethod: PaymentMethod; paymentMethods: PaymentMethod[] };
type Allocation = { vaultId: string; paymentMethod: PaymentMethod | ""; amount: string };
const today = () => new Date().toISOString().slice(0, 10);
const money = (value: string) => formatNumber(value);

export function HrPayrollDetailDialog({ runId, language, onClose, onChanged, onError }: { runId: string; language: Language; onClose: () => void; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [detail, setDetail] = useState<HrPayrollDetail | null>(null);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [vaultsLoaded, setVaultsLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [paymentToReverse, setPaymentToReverse] = useState<HrPayment | null>(null);
  const [reason, setReason] = useState("");
  const [businessDate, setBusinessDate] = useState(today());
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const load = async () => {
    const session = activeSession(); if (!session) return;
    try { setDetail(await getHrPayrollRun(session, runId, { linePageSize: 250, paymentPageSize: 100 })); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "فتح المسير" : "Opening payroll run")); }
  };
  const loadMoreLines = async () => {
    const session = activeSession(); if (!session || !detail?.nextLineCursor || busy) return;
    setBusy(true);
    try { const receipt = await getHrPayrollRun(session, runId, { lineCursor: detail.nextLineCursor, linePageSize: 250, paymentPageSize: 1 }); setDetail((current) => current ? { ...current, lines: [...new Map([...current.lines, ...receipt.lines].map((line) => [line.id, line])).values()], hasMoreLines: receipt.hasMoreLines, nextLineCursor: receipt.nextLineCursor } : current); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تحميل بقية موظفي المسير" : "Loading more payroll employees")); }
    finally { setBusy(false); }
  };
  const loadMorePayments = async () => {
    const session = activeSession(); if (!session || !detail?.nextPaymentCursor || busy) return;
    setBusy(true);
    try { const receipt = await getHrPayrollRun(session, runId, { linePageSize: 1, paymentCursor: detail.nextPaymentCursor, paymentPageSize: 100 }); setDetail((current) => current ? { ...current, payments: [...new Map([...current.payments, ...receipt.payments].map((payment) => [payment.id, payment])).values()], hasMorePayments: receipt.hasMorePayments, nextPaymentCursor: receipt.nextPaymentCursor } : current); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تحميل بقية دفعات المسير" : "Loading more payroll payments")); }
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
      } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تحميل جهات السداد" : "Loading payment destinations")); return; }
      finally { setBusy(false); }
    }
    const vault = availableVaults[0];
    const residual = detail ? String(Number(detail.payrollRun.netPayableAmount) - Number(detail.payrollRun.paidAmount)) : "";
    setBusinessDate(today()); setAllocations(vault ? [{ vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: residual }] : []); setPayOpen(true);
  };
  const updateAllocation = (index: number, patch: Partial<Allocation>) => setAllocations((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const pay = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await payHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate, allocations: allocations.map((allocation) => ({ ...allocation, paymentMethod: allocation.paymentMethod || undefined })), idempotencyKey: requestId() }); setPayOpen(false); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "سداد المسير" : "Paying payroll")); } finally { setBusy(false); } };
  const reverse = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); if (!session || !detail || busy || !reason.trim()) return; setBusy(true); try { await reverseHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate: today(), reason, idempotencyKey: requestId() }); setReverseOpen(false); setReason(""); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "عكس المسير" : "Reversing payroll")); } finally { setBusy(false); } };
  const reversePayment = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); if (!session || !paymentToReverse || busy || !reason.trim()) return; setBusy(true); try { await reverseHrPayrollPayment(session, { payrollPaymentId: paymentToReverse.id, businessDate, reason: reason.trim(), idempotencyKey: requestId() }); setPaymentToReverse(null); setReason(""); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "عكس دفعة المسير" : "Reversing payroll payment")); } finally { setBusy(false); } };
  if (!detail) return null;
  const selectedApplications = (items: Array<{ id: string; amount: string; referenceNumber: string }>) => items.length ? <div className="hr-payroll-create__application-list hr-payroll-detail__applications">{items.map((item) => <label key={item.id} className="is-selected"><input type="checkbox" checked disabled aria-label={item.referenceNumber} /><span>{item.referenceNumber}</span><b dir="ltr">{money(item.amount)}</b></label>)}</div> : "—";
  const paymentColumns = [{ id: "number", header: ar ? "رقم الدفعة" : "Payment no.", cell: (payment: HrPayment) => payment.paymentNumber }, { id: "date", header: ar ? "التاريخ" : "Date", cell: (payment: HrPayment) => payment.businessDate }, { id: "amount", header: ar ? "المبلغ" : "Amount", cell: (payment: HrPayment) => money(payment.amount) }, { id: "status", header: ar ? "الحالة" : "Status", cell: (payment: HrPayment) => payment.status === "POSTED" ? (ar ? "مرحلة" : "Posted") : (ar ? "معكوسة" : "Reversed") }, { id: "action", header: ar ? "الإجراء" : "Action", cell: (payment: HrPayment) => hasActivePermission("hr.payroll.reverse") && payment.status === "POSTED" ? <BaseerButton type="button" variant="danger" onClick={() => { setBusinessDate(today()); setReason(""); setPaymentToReverse(payment); }}>{ar ? "عكس الدفعة" : "Reverse payment"}</BaseerButton> : "—" }];
  const isDraft = status === "DRAFT";
  return <><BaseerDialog open title={detail.payrollRun.runNumber} className="hr-payroll-create-dialog" language={language} busy={busy} onClose={onClose} footer={
    <div className="hr-payroll-detail__footer">
      <div className="hr-payroll-create__total"><span>{ar ? "صافي المستحق" : "Net payable"}</span><strong dir="ltr">{money(detail.payrollRun.netPayableAmount)} SAR</strong></div>
      <div className="page-actions">
        <BaseerOutputActions session={activeSession()!} reportCode="hr.payroll-run" language={language} filters={{ payrollRunId: detail.payrollRun.id }} printLabel={ar ? "معاينة وطباعة A4" : "Preview & print A4"} />
        {isDraft ? <BaseerButton type="button" variant="danger" onClick={() => setDiscardOpen(true)}>{ar ? "حذف المسودة" : "Discard draft"}</BaseerButton> : null}
        {isDraft ? <BaseerButton type="button" onClick={() => void approve()}>{ar ? "اعتماد" : "Approve"}</BaseerButton> : null}
        {status === "APPROVED" || status === "PARTIALLY_PAID" ? <BaseerButton type="button" onClick={() => void openPayment()}>{ar ? "سداد" : "Pay"}</BaseerButton> : null}
        {status === "APPROVED" ? <BaseerButton type="button" variant="danger" onClick={() => setReverseOpen(true)}>{ar ? "عكس" : "Reverse"}</BaseerButton> : null}
      </div>
    </div>
  }>
    <section className="hr-payroll-detail__draft-table">
      <header><strong>{ar ? `قائمة الموظفين (${detail.lines.length})` : `Employees (${detail.lines.length})`}</strong></header>
      <div className="hr-payroll-create__table-wrap"><table><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "إجمالي الراتب" : "Gross salary"}</th><th>{ar ? "السلف" : "Advances"}</th><th>{ar ? "الخصومات الإدارية" : "Administrative deductions"}</th><th>{ar ? "الصافي المستحق" : "Net payable"}</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.id}><td><strong>{line.employeeNumber} · {ar ? line.employeeNameAr : line.employeeNameEn ?? line.employeeNameAr}</strong></td><td><bdi>{money(line.grossSalary)}</bdi></td><td>{selectedApplications(line.advances)}</td><td>{selectedApplications(line.administrativeDeductions)}</td><td><strong dir="ltr">{money(line.netPayableAmount)}</strong></td></tr>)}</tbody></table></div>
      {detail.hasMoreLines ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void loadMoreLines()}>{ar ? "تحميل موظفين إضافيين" : "Load more employees"}</BaseerButton> : null}
      {detail.payments.length ? <DataTable ariaLabel={ar ? "دفعات المسير" : "Payroll payments"} caption={ar ? "دفعات المسير" : "Payroll payments"} rows={detail.payments} rowKey={(payment) => payment.id} columns={paymentColumns} /> : null}
      {detail.hasMorePayments ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void loadMorePayments()}>{ar ? "تحميل دفعات إضافية" : "Load more payments"}</BaseerButton> : null}
    </section>
  </BaseerDialog>
    <BaseerConfirmDialog open={discardOpen} language={language} busy={busy} destructive title={ar ? "حذف مسودة المسير" : "Discard payroll draft"} message={ar ? "سيُحذف هذا المسير قبل الاعتماد. لا توجد قيود محاسبية أو مدفوعات مرتبطة به." : "This draft will be deleted before approval. No accounting entries or payments are attached."} confirmLabel={ar ? "حذف المسودة" : "Discard draft"} onCancel={() => setDiscardOpen(false)} onConfirm={() => void discard()} />
    <BaseerFormDialog open={payOpen} title={ar ? "سداد مسير الرواتب" : "Pay payroll run"} language={language} busy={busy} size="standard" formId="hr-payroll-pay-form" submitLabel={ar ? "تسجيل السداد" : "Record payment"} onClose={() => setPayOpen(false)}>
      <form id="hr-payroll-pay-form" className="baseer-form" onSubmit={(event) => void pay(event)}>
        <BaseerFormSection title={ar ? "بيانات السداد" : "Payment details"}>
          <BaseerFormGrid columns="one"><BaseerDatePicker language={language} label={ar ? "تاريخ السداد" : "Payment date"} max={today()} value={businessDate} onChange={setBusinessDate} /></BaseerFormGrid>
        </BaseerFormSection>
        {allocations.map((allocation, index) => <BaseerFormSection key={`${allocation.vaultId}-${index}`} title={ar ? `توزيع ${index + 1}` : `Allocation ${index + 1}`}>
          <BaseerFormGrid>
            <label>{ar ? "الخزينة" : "Vault"}<BaseerSearchSelect required label={ar ? "الخزينة" : "Vault"} value={allocation.vaultId} placeholder={ar ? "اختر الخزينة" : "Select vault"} options={activeVaults.map((vault) => ({ id: vault.id, label: ar ? vault.nameAr : vault.nameEn }))} onChange={(vaultId) => { const vault = vaults.find((item) => item.id === vaultId); updateAllocation(index, { vaultId, paymentMethod: vault?.paymentMethod ?? "" }); }} /></label>
            <label>{ar ? "طريقة السداد" : "Payment method"}<BaseerSearchSelect searchable={false} required label={ar ? "طريقة السداد" : "Payment method"} value={allocation.paymentMethod} placeholder={ar ? "اختر الطريقة" : "Select method"} options={(vaults.find((vault) => vault.id === allocation.vaultId)?.paymentMethods ?? []).map((method) => ({ id: method, label: method }))} onChange={(paymentMethod) => updateAllocation(index, { paymentMethod: paymentMethod as PaymentMethod })} /></label>
            <label className="baseer-form-field--full">{ar ? "المبلغ" : "Amount"}<BaseerMoneyInput required value={allocation.amount} onValueChange={(amount) => updateAllocation(index, { amount })} /></label>
            {allocations.length > 1 ? <BaseerButton type="button" variant="quiet" onClick={() => setAllocations((items) => items.filter((_, itemIndex) => itemIndex !== index))}>{ar ? "إزالة هذا التوزيع" : "Remove this allocation"}</BaseerButton> : null}
          </BaseerFormGrid>
        </BaseerFormSection>)}
        <BaseerButton type="button" variant="secondary" onClick={() => { const vault = activeVaults.find((item) => !allocations.some((allocation) => allocation.vaultId === item.id)) ?? activeVaults[0]; if (vault) setAllocations((items) => [...items, { vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: "" }]); }}>{ar ? "إضافة خزينة" : "Add vault"}</BaseerButton>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={reverseOpen} title={ar ? "عكس مسير الرواتب" : "Reverse payroll run"} language={language} busy={busy} size="compact" formId="hr-payroll-reverse-form" submitLabel={ar ? "عكس المسير" : "Reverse payroll"} onClose={() => setReverseOpen(false)}>
      <form id="hr-payroll-reverse-form" className="baseer-form" onSubmit={(event) => void reverse(event)}><BaseerFormSection title={ar ? "سبب العكس" : "Reversal reason"}><BaseerFormGrid columns="one"><label>{ar ? "سبب العكس" : "Reversal reason"}<BaseerTextArea compact required value={reason} onValueChange={setReason} /></label></BaseerFormGrid></BaseerFormSection></form>
    </BaseerFormDialog>
    <BaseerFormDialog open={Boolean(paymentToReverse)} title={ar ? "عكس دفعة المسير" : "Reverse payroll payment"} language={language} busy={busy} size="compact" formId="hr-payroll-payment-reverse-form" submitLabel={ar ? "تأكيد العكس" : "Confirm reversal"} onClose={() => setPaymentToReverse(null)}><form id="hr-payroll-payment-reverse-form" className="baseer-form" onSubmit={(event) => void reversePayment(event)}><BaseerFormSection title={paymentToReverse?.paymentNumber ?? ""}><BaseerFormGrid columns="one"><BaseerDatePicker language={language} label={ar ? "تاريخ العكس" : "Reversal date"} max={today()} value={businessDate} onChange={setBusinessDate} /><label>{ar ? "سبب العكس" : "Reversal reason"}<BaseerTextArea compact required value={reason} onValueChange={setReason} /></label></BaseerFormGrid></BaseerFormSection></form></BaseerFormDialog>
  </>;
}
