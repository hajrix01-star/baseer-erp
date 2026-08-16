import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";

type Configuration = {
  profile: { vatAccountingEnabled: boolean } | null;
  vaults: Array<{ id: string; nameAr: string; type: "CASH" | "BANK" | "APP"; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean }>;
  categories: Array<{ id: string; nameAr: string; kind: "PURCHASE" | "EXPENSE"; status: "ACTIVE" }>;
  suppliers: Array<{ id: string; nameAr: string; status: "ACTIVE" }>;
};
type Document = { id: string; documentNumber: string; kind: "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; status: "POSTED" | "CANCELLED"; businessDate: string; grossAmount: string; supplierNameAr: string | null; categoryNameAr: string };

type Form = { kind: "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; categoryId: string; supplierId: string; invoiceNumber: string; missingReason: string; businessDate: string; grossAmount: string; isTaxable: boolean; vaultId: string; notes: string };
const emptyForm: Form = { kind: "PURCHASE", settlementKind: "PAID", categoryId: "", supplierId: "", invoiceNumber: "", missingReason: "", businessDate: "", grossAmount: "", isTaxable: false, vaultId: "", notes: "" };
const amount = (value: string) => new Intl.NumberFormat("en-SA", { maximumFractionDigits: 1, minimumFractionDigits: Number(value) % 1 ? 1 : 0 }).format(Number(value || 0));

export function PurchaseExpenseWorkspace({ language }: { language: "ar" | "en" }) {
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [form, setForm] = useState<Form>(emptyForm);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const current = activeSession(); setSession(current); if (!current) return;
    const [nextConfiguration, nextDocuments] = await Promise.all([
      api<Configuration>(current, "/finance/configuration"),
      api<{ documents: Document[] }>(current, "/finance/purchase-expense-documents"),
    ]);
    setConfiguration(nextConfiguration); setDocuments(nextDocuments.documents);
  }, []);
  useEffect(() => { void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, "تعذر تحميل بيانات المشتريات.") })); }, [language, load]);
  const categories = useMemo(() => configuration?.categories.filter((item) => item.status === "ACTIVE" && item.kind === form.kind) ?? [], [configuration, form.kind]);
  const paymentVaults = useMemo(() => configuration?.vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination) ?? [], [configuration]);
  const change = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || saving) return;
    if (!form.invoiceNumber.trim() && !form.missingReason.trim()) { setMessage({ kind: "error", text: "أدخل رقم فاتورة المورد أو سبب عدم توفره." }); return; }
    if (form.invoiceNumber.trim() && form.missingReason.trim()) { setMessage({ kind: "error", text: "اختر رقم الفاتورة أو سبب عدم توفرها، وليس كليهما." }); return; }
    if (form.settlementKind === "PAID" && !form.vaultId) { setMessage({ kind: "error", text: "اختر خزينة أو قناة دفع." }); return; }
    setSaving(true); setMessage({ kind: "idle", text: "" });
    try {
      await api(current, "/finance/purchase-expense-documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        kind: form.kind, settlementKind: form.settlementKind, categoryId: form.categoryId,
        ...(form.supplierId ? { supplierId: form.supplierId } : {}),
        ...(form.invoiceNumber.trim() ? { supplierInvoiceNumber: form.invoiceNumber.trim() } : { supplierInvoiceMissingReason: form.missingReason.trim() }),
        businessDate: form.businessDate, grossAmount: form.grossAmount, isTaxable: form.isTaxable,
        allocations: form.settlementKind === "PAID" ? [{ vaultId: form.vaultId, grossAmount: form.grossAmount }] : [],
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}), idempotencyKey: requestId(),
      }) });
      setForm(emptyForm); setMessage({ kind: "success", text: "تم حفظ المستند وترحيل أثره المحاسبي." }); await load();
    } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, "تعذر حفظ المستند.") }); }
    finally { setSaving(false); }
  };
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="daily-sales-workspace" aria-label="المشتريات والمصروفات">
    <header className="administration-section-heading"><div><p className="eyebrow">المشتريات والمصروفات</p><h3>فاتورة مورد أو مصروف</h3></div><BaseerButton type="button" onClick={() => void load()}>تحديث</BaseerButton></header>
    {message.kind !== "idle" && <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>}
    {!configuration ? <BaseerCard><p>جارٍ تحميل إعدادات الشركة…</p></BaseerCard> : <>
      {!configuration.profile && <p className="daily-sales-message error">أكمل إعداد الشركة المالي والخزائن أولاً قبل إضافة أي فاتورة أو مصروف.</p>}
      <BaseerCard><form className="administration-form" onSubmit={(event) => void submit(event)}>
        <label>النوع<select value={form.kind} onChange={(event) => change("kind", event.target.value as Form["kind"])}><option value="PURCHASE">مشتريات</option><option value="EXPENSE">مصروف</option></select></label>
        <label>طريقة التسوية<select value={form.settlementKind} onChange={(event) => change("settlementKind", event.target.value as Form["settlementKind"])}><option value="PAID">مدفوع</option><option value="PAYABLE">آجل / التزام</option></select></label>
        <label>البند المالي<select required value={form.categoryId} onChange={(event) => change("categoryId", event.target.value)}><option value="">اختر البند</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
        <label>المورد<select value={form.supplierId} required={form.settlementKind === "PAYABLE"} onChange={(event) => change("supplierId", event.target.value)}><option value="">{form.settlementKind === "PAYABLE" ? "اختر المورد" : "بدون مورد"}</option>{configuration.suppliers.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>
        <label>تاريخ المستند<input required type="date" max={new Date().toISOString().slice(0, 10)} value={form.businessDate} onChange={(event) => change("businessDate", event.target.value)} /></label>
        <label>إجمالي المبلغ (SAR)<input required inputMode="decimal" placeholder="أدخل المبلغ" value={form.grossAmount} onChange={(event) => change("grossAmount", event.target.value)} /></label>
        <label>رقم فاتورة المورد<input value={form.invoiceNumber} placeholder="اختياري عند وجوده" onChange={(event) => change("invoiceNumber", event.target.value)} /></label>
        <label>سبب عدم توفر الفاتورة<input value={form.missingReason} placeholder="عند عدم وجود رقم فاتورة" onChange={(event) => change("missingReason", event.target.value)} /></label>
        {form.settlementKind === "PAID" && <label>خزينة أو قناة الدفع<select value={form.vaultId} onChange={(event) => change("vaultId", event.target.value)}><option value="">اختر قناة الدفع</option>{paymentVaults.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}</select></label>}
        <label><input type="checkbox" checked={form.isTaxable} disabled={!configuration.profile?.vatAccountingEnabled} onChange={(event) => change("isTaxable", event.target.checked)} /> خاضع للضريبة</label>
        <label style={{ gridColumn: "1 / -1" }}>ملاحظات<input value={form.notes} placeholder="ملاحظة اختيارية" onChange={(event) => change("notes", event.target.value)} /></label>
        <BaseerButton variant="primary" disabled={saving || !configuration.profile}>{saving ? "جارٍ الحفظ…" : "حفظ المستند"}</BaseerButton>
      </form></BaseerCard>
      <BaseerCard><div className="administration-section-heading"><div><h3>سجل المشتريات والمصروفات</h3></div><span>{documents.length} مستند</span></div>
        {documents.length ? <div className="administration-list">{documents.map((document) => <article key={document.id}><strong>{document.documentNumber}</strong><span>{document.kind === "PURCHASE" ? "مشتريات" : "مصروف"} · {document.settlementKind === "PAID" ? "مدفوع" : "آجل"}</span><span>{document.categoryNameAr}{document.supplierNameAr ? ` · ${document.supplierNameAr}` : ""}</span><strong>SAR {amount(document.grossAmount)}</strong></article>)}</div> : <p className="empty-results">لا توجد مستندات محفوظة لهذه الشركة بعد.</p>}
      </BaseerCard>
    </>}
  </section>;
}