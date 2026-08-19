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
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { DataTable } from "./data-table";
import { activeSession, api, requestId } from "./daily-sales-client";
import { approveHrPayrollRun, discardHrPayrollRun, getHrPayrollRun, payHrPayrollRun, reverseHrPayrollRun, type HrPayrollDetail } from "./hr-client";
import { formatNumber } from "./number-format";

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
  const [busy, setBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [businessDate, setBusinessDate] = useState(today());
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const load = async () => {
    const session = activeSession(); if (!session) return;
    try { const [run, config] = await Promise.all([getHrPayrollRun(session, runId), api<{ vaults: Vault[] }>(session, "/finance/configuration")]); setDetail(run); setVaults(config.vaults); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "فتح المسير" : "Opening payroll run")); }
  };
  useEffect(() => { void load(); }, [runId]);
  const activeVaults = useMemo(() => vaults.filter((vault) => vault.status === "ACTIVE" && vault.isPaymentDestination), [vaults]);
  const status = detail?.payrollRun.status;
  const approve = async () => { const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await approveHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate: today(), idempotencyKey: requestId() }); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "اعتماد المسير" : "Approving payroll")); } finally { setBusy(false); } };
  const discard = async () => { const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await discardHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, idempotencyKey: requestId() }); setDiscardOpen(false); await onChanged(); onClose(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "حذف المسودة" : "Discarding payroll draft")); } finally { setBusy(false); } };
  const openPayment = () => { const vault = activeVaults[0]; const residual = detail ? String(Number(detail.payrollRun.netPayableAmount) - Number(detail.payrollRun.paidAmount)) : ""; setBusinessDate(today()); setAllocations(vault ? [{ vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: residual }] : []); setPayOpen(true); };
  const updateAllocation = (index: number, patch: Partial<Allocation>) => setAllocations((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  const pay = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); if (!session || !detail || busy) return; setBusy(true); try { await payHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate, allocations: allocations.map((allocation) => ({ ...allocation, paymentMethod: allocation.paymentMethod || undefined })), idempotencyKey: requestId() }); setPayOpen(false); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "سداد المسير" : "Paying payroll")); } finally { setBusy(false); } };
  const reverse = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); if (!session || !detail || busy || !reason.trim()) return; setBusy(true); try { await reverseHrPayrollRun(session, { payrollRunId: detail.payrollRun.id, businessDate: today(), reason, idempotencyKey: requestId() }); setReverseOpen(false); setReason(""); await load(); await onChanged(); } catch (error) { onError(presentBaseerApiError(error, language, ar ? "عكس المسير" : "Reversing payroll")); } finally { setBusy(false); } };
  if (!detail) return null;
  const lineColumns = [{ id: "employee", header: ar ? "الموظف" : "Employee", cell: (line: HrPayrollDetail["lines"][number]) => `${line.employeeNumber} · ${ar ? line.employeeNameAr : line.employeeNameEn ?? line.employeeNameAr}` }, { id: "eligibility", header: ar ? "أهلية الشهر" : "Month eligibility", cell: (line: HrPayrollDetail["lines"][number]) => line.eligibilityCode === "FULL_MONTH_ON_LEAVE_EXCEPTION_V1" ? (ar ? "استثناء إجازة: شهر كامل" : "Leave exception: full month") : line.eligibilityCode === "PRORATED_NEW_HIRE_V1" ? (ar ? "تعيين جديد: استحقاق نسبي" : "New hire: prorated") : (ar ? "شهر كامل" : "Full month") }, { id: "calculation", header: ar ? "الاحتساب الخادمي" : "Server calculation", cell: (line: HrPayrollDetail["lines"][number]) => line.payrollCalculationSnapshot ? `${line.payrollCalculationSnapshot.calculationPeriodStart} → ${line.payrollCalculationSnapshot.calculationPeriodEnd} · ${line.payrollCalculationSnapshot.eligibleDays}/${line.payrollCalculationSnapshot.calendarDaysInMonth} · ${line.payrollCalculationSnapshot.prorationRatio} · ${money(line.grossSalary)}` : money(line.grossSalary) }, { id: "policy", header: ar ? "سياسة التعويض" : "Compensation policy", cell: (line: HrPayrollDetail["lines"][number]) => line.compensationPolicySnapshot ? `${line.compensationPolicySnapshot.policyCode} · v${line.compensationPolicySnapshot.versionNumber}` : (ar ? "افتراضي الشركة" : "Company default") }, { id: "gross", header: ar ? "الإجمالي" : "Gross", cell: (line: HrPayrollDetail["lines"][number]) => money(line.grossSalary) }, { id: "basic", header: ar ? "الأساسي" : "Base", cell: (line: HrPayrollDetail["lines"][number]) => money(line.basicSalary) }, { id: "housing", header: ar ? "السكن" : "Housing", cell: (line: HrPayrollDetail["lines"][number]) => money(line.housingAllowance) }, { id: "transport", header: ar ? "المواصلات" : "Transport", cell: (line: HrPayrollDetail["lines"][number]) => money(line.transportAllowance) }, { id: "food", header: ar ? "بدل الأكل" : "Food", cell: (line: HrPayrollDetail["lines"][number]) => money(line.foodAllowance) }, { id: "overtime", header: ar ? "الأوفر تايم" : "Overtime", cell: (line: HrPayrollDetail["lines"][number]) => line.compensationMethod === "INCLUSIVE_OVERTIME" ? `${money(line.overtimeAmount)} · ${money(line.overtimeHours)}h` : "—" }, { id: "adv", header: ar ? "السلف" : "Advances", cell: (line: HrPayrollDetail["lines"][number]) => money(line.advanceSettlementAmount) }, { id: "ded", header: ar ? "الخصومات" : "Deductions", cell: (line: HrPayrollDetail["lines"][number]) => money(line.administrativeDeductionAmount) }, { id: "net", header: ar ? "الصافي" : "Net", cell: (line: HrPayrollDetail["lines"][number]) => money(line.netPayableAmount) }, { id: "paid", header: ar ? "المدفوع" : "Paid", cell: (line: HrPayrollDetail["lines"][number]) => money(line.paidAmount) }];
  return <><BaseerDialog open title={detail.payrollRun.runNumber} language={language} busy={busy} onClose={onClose} footer={<div className="page-actions"><BaseerOutputActions session={activeSession()!} reportCode="hr.payroll-run" language={language} filters={{ payrollRunId: detail.payrollRun.id }} printLabel={ar ? "معاينة وطباعة A4" : "Preview & print A4"} />{status === "DRAFT" ? <BaseerButton type="button" variant="danger" onClick={() => setDiscardOpen(true)}>{ar ? "حذف المسودة" : "Discard draft"}</BaseerButton> : null}{status === "DRAFT" ? <BaseerButton type="button" onClick={() => void approve()}>{ar ? "اعتماد" : "Approve"}</BaseerButton> : null}{status === "APPROVED" || status === "PARTIALLY_PAID" ? <BaseerButton type="button" onClick={openPayment}>{ar ? "سداد" : "Pay"}</BaseerButton> : null}{status === "APPROVED" ? <BaseerButton type="button" variant="danger" onClick={() => setReverseOpen(true)}>{ar ? "عكس" : "Reverse"}</BaseerButton> : null}</div>}><BaseerSummaryMetricGrid><BaseerSummaryMetric label={ar ? "الإجمالي" : "Gross"} value={money(detail.payrollRun.grossAmount)} /><BaseerSummaryMetric label={ar ? "السلف" : "Advances"} value={money(detail.payrollRun.advanceSettlementAmount)} /><BaseerSummaryMetric label={ar ? "الخصومات" : "Deductions"} value={money(detail.payrollRun.administrativeDeductionAmount)} /><BaseerSummaryMetric label={ar ? "الصافي" : "Net"} value={money(detail.payrollRun.netPayableAmount)} /></BaseerSummaryMetricGrid><DataTable ariaLabel={ar ? "سطور المسير" : "Payroll lines"} caption={ar ? "سطور المسير" : "Payroll lines"} rows={detail.lines} rowKey={(line) => line.id} columns={lineColumns} /></BaseerDialog>
    <BaseerConfirmDialog open={discardOpen} language={language} busy={busy} destructive title={ar ? "حذف مسودة المسير" : "Discard payroll draft"} message={ar ? "سيُحذف هذا المسير قبل الاعتماد. لا توجد قيود محاسبية أو مدفوعات مرتبطة به." : "This draft will be deleted before approval. No accounting entries or payments are attached."} confirmLabel={ar ? "حذف المسودة" : "Discard draft"} onCancel={() => setDiscardOpen(false)} onConfirm={() => void discard()} />
    <BaseerFormDialog open={payOpen} title={ar ? "سداد مسير الرواتب" : "Pay payroll run"} language={language} busy={busy} size="standard" formId="hr-payroll-pay-form" submitLabel={ar ? "تسجيل السداد" : "Record payment"} onClose={() => setPayOpen(false)}>
      <form id="hr-payroll-pay-form" className="baseer-form" onSubmit={(event) => void pay(event)}>
        <BaseerFormSection title={ar ? "بيانات السداد" : "Payment details"} description={ar ? "اختر تاريخ السداد ثم وزّع المبلغ على الخزائن." : "Choose the payment date, then allocate the amount across vaults."}>
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
  </>;
}
