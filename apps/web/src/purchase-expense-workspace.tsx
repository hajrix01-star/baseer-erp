import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";

type Configuration = { profile: { vatAccountingEnabled: boolean; vatRateBasisPoints: number } | null; vaults: Array<{ id: string; nameAr: string; type: "CASH" | "BANK" | "APP"; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean }>; categories: Array<{ id: string; nameAr: string; kind: "PURCHASE" | "EXPENSE"; status: "ACTIVE" }>; suppliers: Array<{ id: string; nameAr: string; status: "ACTIVE" }> };
type Document = { id: string; documentNumber: string; kind: "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; status: "POSTED" | "CANCELLED"; businessDate: string; grossAmount: string; batchNumber: string | null; supplierNameAr: string | null; categoryNameAr: string };
type BatchRow = { id: string; kind: "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; categoryId: string; supplierId: string; invoiceNumber: string; missingReason: string; supplierInvoiceDate: string; grossAmount: string; isTaxable: boolean; vaultId: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);
const newRow = (): BatchRow => ({ id: requestId(), kind: "PURCHASE", settlementKind: "PAID", categoryId: "", supplierId: "", invoiceNumber: "", missingReason: "", supplierInvoiceDate: "", grossAmount: "", isTaxable: false, vaultId: "", notes: "" });
const number = (value: string) => Number(value || 0);
const amount = (value: number) => new Intl.NumberFormat("en-SA", { maximumFractionDigits: 1, minimumFractionDigits: value % 1 ? 1 : 0 }).format(value);

export function PurchaseExpenseWorkspace({ language }: { language: "ar" | "en" }) {
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [businessDate, setBusinessDate] = useState(today);
  const [batchNotes, setBatchNotes] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([newRow()]);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const current = activeSession(); setSession(current); if (!current) return;
    const [nextConfiguration, nextDocuments] = await Promise.all([api<Configuration>(current, "/finance/configuration"), api<{ documents: Document[] }>(current, "/finance/purchase-expense-documents")]);
    setConfiguration(nextConfiguration); setDocuments(nextDocuments.documents);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, "تعذر تحميل بيانات المشتريات.") })); }, [language, load]);
  const paymentVaults = useMemo(() => configuration?.vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination) ?? [], [configuration]);
  const totals = useMemo(() => rows.reduce((total, row) => {
    const gross = number(row.grossAmount); const rate = row.isTaxable && configuration?.profile?.vatAccountingEnabled ? configuration.profile.vatRateBasisPoints ?? 0 : 0;
    const net = rate ? gross * 10_000 / (10_000 + rate) : gross; return { gross: total.gross + gross, net: total.net + net, vat: total.vat + gross - net };
  }, { gross: 0, net: 0, vat: 0 }), [configuration?.profile, rows]);
  const change = <K extends keyof BatchRow>(rowId: string, key: K, value: BatchRow[K]) => setRows((current) => current.map((row) => row.id === rowId ? { ...row, [key]: value } : row));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return;
    if (!businessDate) { setMessage({ kind: "error", text: "اختر تاريخ الدفعة." }); return; }
    for (const [index, row] of rows.entries()) {
      if (!row.categoryId || !row.grossAmount || number(row.grossAmount) <= 0) { setMessage({ kind: "error", text: `أكمل البند والمبلغ في الفاتورة رقم ${index + 1}.` }); return; }
      if (!row.invoiceNumber.trim() && !row.missingReason.trim()) { setMessage({ kind: "error", text: `أدخل رقم الفاتورة أو سبب عدم توفره في الفاتورة رقم ${index + 1}.` }); return; }
      if (row.invoiceNumber.trim() && row.missingReason.trim()) { setMessage({ kind: "error", text: `اختر رقم الفاتورة أو سبب عدم توفرها في الفاتورة رقم ${index + 1}.` }); return; }
      if (row.settlementKind === "PAYABLE" && !row.supplierId) { setMessage({ kind: "error", text: `اختر المورد للفاتورة الآجلة رقم ${index + 1}.` }); return; }
      if (row.settlementKind === "PAID" && !row.vaultId) { setMessage({ kind: "error", text: `اختر قناة الدفع للفاتورة رقم ${index + 1}.` }); return; }
    }
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try {
      const receipt = await api<{ batchNumber: string; documentCount: number }>(current, "/finance/purchase-expense-documents/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessDate, ...(batchNotes.trim() ? { notes: batchNotes.trim() } : {}), items: rows.map((row) => ({ kind: row.kind, settlementKind: row.settlementKind, categoryId: row.categoryId, ...(row.supplierId ? { supplierId: row.supplierId } : {}), ...(row.invoiceNumber.trim() ? { supplierInvoiceNumber: row.invoiceNumber.trim() } : { supplierInvoiceMissingReason: row.missingReason.trim() }), ...(row.supplierInvoiceDate ? { supplierInvoiceDate: row.supplierInvoiceDate } : {}), grossAmount: row.grossAmount, isTaxable: row.isTaxable, allocations: row.settlementKind === "PAID" ? [{ vaultId: row.vaultId, grossAmount: row.grossAmount }] : [], ...(row.notes.trim() ? { notes: row.notes.trim() } : {}) })), idempotencyKey: requestId() }) });
      setRows([newRow()]); setBatchNotes(""); setMessage({ kind: "success", text: `تم حفظ الدفعة ${receipt.batchNumber} وعددها ${receipt.documentCount} فاتورة، مع ترحيل أثر كل فاتورة محاسبياً.` }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, "تعذر حفظ دفعة الفواتير.") }); } finally { setSaving(false); }
  };
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="daily-sales-workspace purchase-batch-workspace" aria-label="المشتريات والمصروفات">
    <header className="administration-section-heading"><div><p className="eyebrow">المشتريات والمصروفات</p><h3>إدخال فواتير جماعي</h3><p>أضف عدة فواتير في دفعة واحدة؛ كل فاتورة تُراجع وتُرحّل كقيد مستقل.</p></div><BaseerButton type="button" onClick={() => void load()}>تحديث</BaseerButton></header>
    {message.kind !== "idle" && <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>}
    {!configuration ? <BaseerCard><p>جارٍ تحميل إعدادات الشركة…</p></BaseerCard> : <>
      {!configuration.profile && <p className="daily-sales-message error">أكمل إعداد الشركة المالي والخزائن والفئات والموردين أولاً قبل إدخال الفواتير.</p>}
      <BaseerCard><form onSubmit={(event) => void submit(event)} className="purchase-batch-form">
        <div className="purchase-batch-header"><label>تاريخ الدفعة<input required type="date" max={today()} value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></label><label>ملاحظة للدفعة<input value={batchNotes} placeholder="اختيارية" onChange={(event) => setBatchNotes(event.target.value)} /></label></div>
        <div className="purchase-batch-rows">{rows.map((row, index) => {
          const categories = configuration.categories.filter((item) => item.status === "ACTIVE" && item.kind === row.kind);
          return <article className="purchase-batch-row" key={row.id}><header><strong>فاتورة {index + 1}</strong><BaseerButton type="button" variant="secondary" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>حذف</BaseerButton></header><div className="purchase-batch-grid">
            <label>النوع<select value={row.kind} onChange={(event) => change(row.id, "kind", event.target.value as BatchRow["kind"])}><option value="PURCHASE">مشتريات</option><option value="EXPENSE">مصروف</option></select></label>
            <label>التسوية<select value={row.settlementKind} onChange={(event) => change(row.id, "settlementKind", event.target.value as BatchRow["settlementKind"])}><option value="PAID">مدفوع</option><option value="PAYABLE">آجل</option></select></label>
            <label>البند المالي<select required value={row.categoryId} onChange={(event) => change(row.id, "categoryId", event.target.value)}><option value="">اختر البند</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
            <label>المورد<select value={row.supplierId} required={row.settlementKind === "PAYABLE"} onChange={(event) => change(row.id, "supplierId", event.target.value)}><option value="">{row.settlementKind === "PAYABLE" ? "اختر المورد" : "بدون مورد"}</option>{configuration.suppliers.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
            <label>رقم الفاتورة<input value={row.invoiceNumber} placeholder="رقم فاتورة المورد" onChange={(event) => change(row.id, "invoiceNumber", event.target.value)} /></label>
            <label>تاريخ الفاتورة<input type="date" max={businessDate || today()} value={row.supplierInvoiceDate} onChange={(event) => change(row.id, "supplierInvoiceDate", event.target.value)} /></label>
            <label>إجمالي المبلغ (SAR)<input required inputMode="decimal" placeholder="أدخل المبلغ" value={row.grossAmount} onChange={(event) => change(row.id, "grossAmount", event.target.value)} /></label>
            {row.settlementKind === "PAID" && <label>قناة الدفع<select value={row.vaultId} onChange={(event) => change(row.id, "vaultId", event.target.value)}><option value="">اختر القناة</option>{paymentVaults.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>}
            <label className="purchase-tax-toggle"><input type="checkbox" checked={row.isTaxable} disabled={!configuration.profile?.vatAccountingEnabled} onChange={(event) => change(row.id, "isTaxable", event.target.checked)} />{row.isTaxable ? "شامل الضريبة" : "بدون ضريبة"}</label>
            <label>سبب عدم توفر الفاتورة<input value={row.missingReason} placeholder="عند عدم وجود رقم" onChange={(event) => change(row.id, "missingReason", event.target.value)} /></label>
            <label className="purchase-batch-wide">ملاحظة<input value={row.notes} placeholder="اختيارية" onChange={(event) => change(row.id, "notes", event.target.value)} /></label>
          </div></article>;
        })}</div>
        <footer className="purchase-batch-footer"><div className="purchase-batch-total"><span>الصافي <strong>SAR {amount(totals.net)}</strong></span><span>الضريبة <strong>SAR {amount(totals.vat)}</strong></span><span>الإجمالي <strong>SAR {amount(totals.gross)}</strong></span></div><div><BaseerButton type="button" variant="secondary" onClick={() => setRows((current) => [...current, newRow()])}>إضافة فاتورة</BaseerButton><BaseerButton variant="primary" disabled={saving || !configuration.profile}>{saving ? "جارٍ الحفظ…" : `حفظ ${rows.length} فاتورة`}</BaseerButton></div></footer>
      </form></BaseerCard>
      <BaseerCard><div className="administration-section-heading"><div><h3>سجل الفواتير</h3></div><span>{documents.length} فاتورة</span></div>{documents.length ? <div className="administration-list">{documents.map((document) => <article key={document.id}><strong>{document.documentNumber}</strong><span>{document.batchNumber ? `دفعة ${document.batchNumber}` : "إدخال منفرد"}</span><span>{document.categoryNameAr}{document.supplierNameAr ? ` · ${document.supplierNameAr}` : ""}</span><strong>SAR {amount(number(document.grossAmount))}</strong></article>)}</div> : <p className="empty-results">لا توجد فواتير محفوظة لهذه الشركة بعد.</p>}</BaseerCard>
    </>}
  </section>;
}