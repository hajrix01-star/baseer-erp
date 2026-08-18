import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDatePicker } from "./baseer-date-picker";
import { DataTable } from "./data-table";
import { OutflowBatchEntryTable } from "./outflow-batch-entry-table";
import { formatMoney } from "./number-format";
import { presentBaseerApiError } from "./baseer-api-error";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";
import { useDialogFocusTrap } from "./use-dialog-focus-trap";

type Configuration = { profile: { vatAccountingEnabled: boolean; vatRateBasisPoints: number } | null; vaults: Array<{ id: string; nameAr: string; nameEn: string; type: "CASH" | "BANK" | "APP"; status: "ACTIVE" | "ARCHIVED"; isPaymentDestination: boolean }>; categories: Array<{ id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE"; status: "ACTIVE"; isPosting?: boolean }>; suppliers: Array<{ id: string; nameAr: string; nameEn: string | null; status: "ACTIVE"; categoryId: string | null; isFavorite: boolean }> };
type Document = { id: string; documentNumber: string; kind: "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; status: "POSTED" | "CANCELLED"; businessDate: string; grossAmount: string; batchNumber: string | null; supplierNameAr: string | null; supplierNameEn: string | null; categoryNameAr: string; categoryNameEn: string };
type CreditWorkspace = { companyId: string; asOfBusinessDate: string; openSupplierCount: number; openInvoiceCount: number; originalAmount: string; paidAmount: string; remainingAmount: string; suppliers: Array<{ supplierId: string; supplierNameAr: string; supplierNameEn: string | null; invoiceCount: number; originalAmount: string; paidAmount: string; remainingAmount: string; dues: Array<{ id: string; documentNumber: string; kind: "PURCHASE" | "EXPENSE"; businessDate: string; dueDate: string | null; categoryNameAr: string | null; categoryNameEn: string | null; originalAmount: string; paidAmount: string; remainingAmount: string }> }> };
type BatchRow = { id: string; kind: "" | "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; categoryId: string; supplierId: string; invoiceNumber: string; missingReason: string; supplierInvoiceDate: string; grossAmount: string; isTaxable: boolean; vaultId: string; notes: string };

const newRow = (): BatchRow => ({ id: requestId(), kind: "", settlementKind: "PAID", categoryId: "", supplierId: "", invoiceNumber: "", missingReason: "", supplierInvoiceDate: "", grossAmount: "", isTaxable: true, vaultId: "", notes: "" });
const initialRows = () => Array.from({ length: 3 }, newRow);
const rowHasValue = (row: BatchRow) => Boolean(row.categoryId || row.supplierId || row.invoiceNumber.trim() || row.missingReason.trim() || row.supplierInvoiceDate || row.grossAmount.trim() || row.vaultId || row.notes.trim());

export function PurchaseExpenseWorkspace({ language }: { language: "ar" | "en" }) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [credit, setCredit] = useState<CreditWorkspace | null>(null);
  const [tab, setTab] = useState<"entry" | "credit">("entry");
  const [businessDate, setBusinessDate] = useState("");
  const [lastReceipt, setLastReceipt] = useState<{ grossAmount: string; netAmount: string; vatAmount: string; documentCount: number } | null>(null);
  const [batchNotes, setBatchNotes] = useState("");
  const [rows, setRows] = useState<BatchRow[]>(initialRows);
  const [message, setMessage] = useState<{ kind: "idle" | "success" | "error"; text: string }>({ kind: "idle", text: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { const current = activeSession(); setSession(current); if (!current) return; const [nextConfiguration, nextDocuments] = await Promise.all([api<Configuration>(current, "/finance/configuration"), api<{ documents: Document[] }>(current, "/finance/purchase-expense-documents")]); setConfiguration(nextConfiguration); setDocuments(nextDocuments.documents); }, []);
  const loadCredit = useCallback(async () => { const current = activeSession(); if (!current) return; const snapshot = await api<CreditWorkspace>(current, "/finance/purchase-expense-documents/credit-workspace"); setCredit(snapshot); setBusinessDate((currentDate) => currentDate || snapshot.asOfBusinessDate.slice(0, 10)); }, []);
  useEffect(() => { void load().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.loadingPurchaseData) })); }, [language, load, text.loadingPurchaseData]);
  useEffect(() => { if (tab === "credit") void loadCredit().catch((error) => setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.credit) })); }, [language, loadCredit, tab, text.credit]);

  const categories = useMemo(() => configuration?.categories.filter((item) => item.status === "ACTIVE" && item.isPosting !== false) ?? [], [configuration]);
  const suppliers = useMemo(() => (configuration?.suppliers.filter((item) => item.status === "ACTIVE") ?? []).slice().sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite) || displayName(language, left).localeCompare(displayName(language, right), language)), [configuration, language]);
  const paymentVaults = useMemo(() => configuration?.vaults.filter((item) => item.status === "ACTIVE" && item.isPaymentDestination) ?? [], [configuration]);
  const enteredRows = useMemo(() => rows.filter(rowHasValue), [rows]);
  const change = <K extends keyof BatchRow>(rowId: string, key: K, value: BatchRow[K]) => setRows((current) => current.map((row) => row.id !== rowId ? row : key === "kind" ? { ...row, kind: value as BatchRow["kind"], categoryId: "" } : { ...row, [key]: value }));
  const chooseSupplier = (rowId: string, supplierId: string) => setRows((current) => current.map((row) => { if (row.id !== rowId) return row; const supplier = suppliers.find((item) => item.id === supplierId); const categoryId = supplier?.categoryId && categories.some((category) => category.id === supplier.categoryId && category.kind === row.kind) ? supplier.categoryId : row.categoryId; return { ...row, supplierId, categoryId }; }));
  const setSupplierFavorite = async (supplierId: string, isFavorite: boolean) => { const current = activeSession(); if (!current) return; setConfiguration((prior) => prior ? { ...prior, suppliers: prior.suppliers.map((supplier) => supplier.id === supplierId ? { ...supplier, isFavorite } : supplier) } : prior); try { await api(current, "/finance/master-data/suppliers/favorite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierId, isFavorite, idempotencyKey: requestId() }) }); } catch (error) { setConfiguration((prior) => prior ? { ...prior, suppliers: prior.suppliers.map((supplier) => supplier.id === supplierId ? { ...supplier, isFavorite: !isFavorite } : supplier) } : prior); setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.supplierFavorite) }); } };
  const renderSupplierAction = (supplier: { id: string; isFavorite?: boolean }) => { const isFavorite = Boolean(supplier.isFavorite); return <BaseerButton aria-label={isFavorite ? text.removeFavoriteSupplier : text.addFavoriteSupplier} title={isFavorite ? text.removeFavoriteSupplier : text.addFavoriteSupplier} type="button" variant="icon" style={{ width: "2rem", minWidth: "2rem", minHeight: "2rem", padding: 0, border: 0, background: "transparent", boxShadow: "none", color: isFavorite ? "var(--brand)" : "var(--muted)" }} onClick={() => void setSupplierFavorite(supplier.id, !isFavorite)}>{isFavorite ? "★" : "☆"}</BaseerButton>; };
  const remove = (rowId: string) => setRows((current) => current.length === 1 ? current : current.filter((row) => row.id !== rowId));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; if (!businessDate) { setMessage({ kind: "error", text: text.selectDate }); return; } if (!enteredRows.length) { setMessage({ kind: "error", text: text.atLeastOneRow }); return; } for (const [index, row] of enteredRows.entries()) { if (!row.kind || !row.categoryId || !row.grossAmount || !Number.isFinite(Number(row.grossAmount)) || Number(row.grossAmount) <= 0 || (!row.invoiceNumber.trim() && !row.missingReason.trim()) || (row.invoiceNumber.trim() && row.missingReason.trim()) || (row.settlementKind === "PAYABLE" && !row.supplierId) || (row.settlementKind === "PAID" && !row.vaultId)) { setMessage({ kind: "error", text: text.invoiceValidation(index + 1) }); return; } } setSaving(true); setMessage({ kind: "idle", text: "" }); try { const receipt = await api<{ documentCount: number; grossAmount: string; netAmount: string; vatAmount: string }>(current, "/finance/purchase-expense-documents/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessDate, ...(batchNotes.trim() ? { notes: batchNotes.trim() } : {}), items: enteredRows.map((row) => ({ kind: row.kind, settlementKind: row.settlementKind, categoryId: row.categoryId, ...(row.supplierId ? { supplierId: row.supplierId } : {}), ...(row.invoiceNumber.trim() ? { supplierInvoiceNumber: row.invoiceNumber.trim() } : { supplierInvoiceMissingReason: row.missingReason.trim() }), ...(row.supplierInvoiceDate ? { supplierInvoiceDate: row.supplierInvoiceDate } : {}), grossAmount: row.grossAmount, isTaxable: row.isTaxable, allocations: row.settlementKind === "PAID" ? [{ vaultId: row.vaultId, grossAmount: row.grossAmount }] : [], ...(row.notes.trim() ? { notes: row.notes.trim() } : {}) })), idempotencyKey: requestId() }) }); setRows(initialRows()); setBatchNotes(""); setLastReceipt(receipt); setMessage({ kind: "success", text: text.batchSaved(receipt.documentCount) }); await Promise.all([load(), loadCredit()]); } catch (error) { setMessage({ kind: "error", text: presentBaseerApiError(error, language, text.saveBatch) }); } finally { setSaving(false); } };
  if (!session) return <DailySalesSignIn language={language} />;
  const activeTabStyle = {
    minHeight: "2.5rem",
    paddingInline: "1rem",
    border: "1px solid var(--line)",
    borderBottom: "1px solid var(--surface)",
    borderRadius: "8px 8px 0 0",
    color: "var(--brand-deep)",
    background: "var(--surface)",
    boxShadow: "none",
  };
  const inactiveTabStyle = {
    minHeight: "2.5rem",
    paddingInline: "1rem",
    border: "1px solid transparent",
    borderBottom: "1px solid var(--line)",
    borderRadius: "8px 8px 0 0",
    color: "var(--muted)",
    background: "transparent",
    boxShadow: "none",
  };

  return <section className="daily-sales-workspace purchase-batch-workspace" aria-label={text.purchases}>
    {message.kind !== "idle" && <p className={`daily-sales-message ${message.kind}`}>{message.text}</p>}
    {!configuration ? <BaseerCard><p>{text.loadingCompanySetup}</p></BaseerCard> : <section style={{ minWidth: 0 }}>
      <nav aria-label={text.batchInvoices} role="tablist" style={{ display: "inline-flex", alignSelf: "flex-start", gap: 0, marginBlockEnd: "-1px", position: "relative", zIndex: 1 }}>
        <BaseerButton id="purchase-tab-entry" role="tab" aria-selected={tab === "entry"} aria-controls="purchase-panel-entry" type="button" variant="secondary" style={tab === "entry" ? activeTabStyle : inactiveTabStyle} onClick={() => setTab("entry")}>{text.entry}</BaseerButton>
        <BaseerButton id="purchase-tab-credit" role="tab" aria-selected={tab === "credit"} aria-controls="purchase-panel-credit" type="button" variant="secondary" style={tab === "credit" ? activeTabStyle : inactiveTabStyle} onClick={() => setTab("credit")}>{text.credit}</BaseerButton>
      </nav>
      <div id={`purchase-panel-${tab}`} role="tabpanel" aria-labelledby={`purchase-tab-${tab}`} style={{ minWidth: 0, border: "1px solid var(--line)", borderRadius: "8px", borderStartStartRadius: 0, background: "var(--surface)", boxShadow: "none", padding: "var(--card-padding-compact)" }}>
        {tab === "entry" ? <>
          {!configuration.profile && <p className="daily-sales-message error">{text.setupRequired}</p>}
          <form onSubmit={(event) => void submit(event)} className="purchase-batch-form">
            <div className="purchase-batch-header">
              <label>{text.batchDate}<BaseerDatePicker plain presentation="popover" language={language} label={text.batchDate} value={businessDate} onChange={setBusinessDate} /></label>
              <label>{text.batchNotes}<input value={batchNotes} placeholder={text.optional} onChange={(event) => setBatchNotes(event.target.value)} /></label>
            </div>
            <OutflowBatchEntryTable language={language} text={text} ariaLabel={text.batchEntry} rows={rows} categories={categories} suppliers={suppliers} vaults={paymentVaults} vatEnabled={Boolean(configuration.profile?.vatAccountingEnabled)} vatRateBasisPoints={configuration.profile?.vatRateBasisPoints ?? 1500} allowedKinds={["PURCHASE", "EXPENSE"]} maxInvoiceDate={businessDate || undefined} onChange={change} onSupplierChange={chooseSupplier} renderSupplierAction={renderSupplierAction} onRemove={remove} />
            <footer className="purchase-batch-footer"><div className="purchase-batch-total">{lastReceipt ? <><span>{text.net} <strong>{formatMoney(lastReceipt.netAmount)}</strong></span><span>{text.tax} <strong>{formatMoney(lastReceipt.vatAmount)}</strong></span><span>{text.lastBatchTotal} <strong>{formatMoney(lastReceipt.grossAmount)}</strong></span></> : null}</div><div><BaseerButton aria-label={text.addRow} type="button" variant="icon" className="purchase-batch-add-row" onClick={() => setRows((current) => [...current, newRow()])}>+</BaseerButton><BaseerButton variant="secondary" style={{ minHeight: "2.5rem", padding: "0 .25rem", border: 0, background: "transparent", boxShadow: "none", color: "var(--brand)" }} disabled={saving || !configuration.profile}>{saving ? text.saving : text.saveInvoiceCount(enteredRows.length)}</BaseerButton></div></footer>
          </form>
          <section style={{ marginTop: "var(--section-gap)", paddingTop: "var(--section-gap)", borderTop: "1px solid var(--line)" }}>
            <div className="administration-section-heading"><div><h3>{text.invoiceHistory}</h3></div><span>{documents.length} {text.invoiceCount}</span></div>
            {documents.length ? <div className="administration-list">{documents.map((document) => <article key={document.id}><strong>{document.documentNumber}</strong><span>{document.kind === "PURCHASE" ? text.purchaseInvoice : text.expenseInvoice} · {document.businessDate.slice(0, 10)}</span><span>{displayName(language, { nameAr: document.categoryNameAr, nameEn: document.categoryNameEn })}{document.supplierNameAr ? ` · ${displayName(language, { nameAr: document.supplierNameAr, nameEn: document.supplierNameEn })}` : ""}</span><strong>{formatMoney(document.grossAmount)}</strong></article>)}</div> : <p className="empty-results">{text.noInvoices}</p>}
          </section>
        </> : <CreditPanel credit={credit} language={language} vaults={paymentVaults} reload={loadCredit} />}
      </div>
    </section>}
  </section>;
}

function CreditPanel({ credit, language, vaults, reload }: { credit: CreditWorkspace | null; language: "ar" | "en"; vaults: ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>; reload: () => Promise<void> }) {
  const text = financeText(language);
  const [target, setTarget] = useState<CreditWorkspace["suppliers"][number]["dues"][number] | null>(null);
  const [message, setMessage] = useState("");
  if (!credit) return <BaseerCard><p>{text.loading}</p></BaseerCard>;

  const invoices = credit.suppliers.flatMap((supplier) => supplier.dues.map((due) => ({ ...due, supplierNameAr: supplier.supplierNameAr, supplierNameEn: supplier.supplierNameEn })));
  const metricCardStyle = { display: "grid", alignContent: "center", gap: ".35rem", minBlockSize: "5.5rem" };

  return <>
    <div aria-label={text.credit} role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "var(--section-gap)" }}>
      <BaseerCard padding="compact" role="listitem" style={metricCardStyle}><p style={{ margin: 0 }}>{text.openCreditSuppliers}</p><strong>{credit.openSupplierCount}</strong></BaseerCard>
      <BaseerCard padding="compact" role="listitem" style={metricCardStyle}><p style={{ margin: 0 }}>{text.openCreditInvoices}</p><strong>{credit.openInvoiceCount}</strong></BaseerCard>
      <BaseerCard padding="compact" role="listitem" style={metricCardStyle}><p style={{ margin: 0 }}>{text.creditOutstanding}</p><strong>{formatMoney(credit.remainingAmount)}</strong></BaseerCard>
    </div>
    {message ? <p className="daily-sales-message success">{message}</p> : null}
    <section style={{ marginTop: "var(--section-gap)", paddingTop: "var(--section-gap)", borderTop: "1px solid var(--line)" }}>
      <div className="administration-section-heading"><div><h3>{text.openCreditInvoices}</h3><p>{text.creditAsOf} {credit.asOfBusinessDate.slice(0, 10)}</p></div></div>
      {invoices.length ? <DataTable ariaLabel={text.openCreditInvoices} caption={text.openCreditInvoices} rowKey={(invoice) => invoice.id} columns={[
        { id: "supplier", header: text.supplier, width: "15rem", cell: (invoice) => displayName(language, { nameAr: invoice.supplierNameAr, nameEn: invoice.supplierNameEn }) },
        { id: "number", header: text.invoiceNumber, width: "10rem", cell: (invoice) => invoice.documentNumber },
        { id: "kind", header: text.invoiceType, width: "8rem", cell: (invoice) => invoice.kind === "PURCHASE" ? text.purchaseInvoice : text.expenseInvoice },
        { id: "category", header: text.financialCategory, width: "13rem", cell: (invoice) => displayName(language, { nameAr: invoice.categoryNameAr ?? "—", nameEn: invoice.categoryNameEn ?? "—" }) },
        { id: "date", header: text.supplierInvoiceDate, width: "9rem", cell: (invoice) => invoice.businessDate.slice(0, 10) },
        { id: "remaining", header: text.outstanding, width: "9rem", numeric: true, cell: (invoice) => formatMoney(invoice.remainingAmount) },
        { id: "action", header: "", width: "10rem", cell: (invoice) => <BaseerButton type="button" variant="secondary" onClick={() => setTarget(invoice)}>{text.recordSettlement}</BaseerButton> },
      ]} rows={invoices} /> : <p className="empty-results">{text.noCreditInvoices}</p>}
    </section>
    <CreditPaymentDialog language={language} due={target} vaults={vaults} defaultBusinessDate={credit.asOfBusinessDate.slice(0, 10)} onClose={() => setTarget(null)} onSaved={async () => { setTarget(null); setMessage(text.repaymentSaved); await reload(); }} />
  </>;
}

function CreditPaymentDialog({ language, due, vaults, defaultBusinessDate, onClose, onSaved }: { language: "ar" | "en"; due: CreditWorkspace["suppliers"][number]["dues"][number] | null; vaults: ReadonlyArray<{ id: string; nameAr: string; nameEn: string }>; defaultBusinessDate: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const text = financeText(language); const [vaultId, setVaultId] = useState(""); const [amount, setAmount] = useState(""); const [businessDate, setBusinessDate] = useState(defaultBusinessDate); const [saving, setSaving] = useState(false); const [error, setError] = useState(""); const dialogRef = useDialogFocusTrap({ open: due !== null, saving, onClose });
  useEffect(() => { if (due) { setVaultId(""); setAmount(due.remainingAmount); setBusinessDate(defaultBusinessDate); setError(""); } }, [defaultBusinessDate, due]);
  if (!due) return null;
  const submit = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || saving) return; if (!vaultId || !amount || Number(amount) <= 0 || Number(amount) > Number(due.remainingAmount) || !businessDate) { setError(text.paymentValidation(1)); return; } setSaving(true); setError(""); try { await api(current, "/finance/supplier-dues/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dueId: due.id, vaultId, businessDate, amount, idempotencyKey: requestId() }) }); await onSaved(); } catch (requestError) { setError(presentBaseerApiError(requestError, language, text.recordSettlement)); } finally { setSaving(false); } };
  return <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={() => !saving && onClose()}><section ref={dialogRef} className="daily-sales-dialog" role="dialog" aria-modal="true" aria-labelledby="credit-payment-dialog-title" onMouseDown={(event) => event.stopPropagation()}><header className="daily-sales-dialog__header"><div><h3 id="credit-payment-dialog-title">{text.recordSettlement}</h3><p>{due.documentNumber} · {formatMoney(due.remainingAmount)}</p></div><button className="dialog-icon-button" type="button" aria-label={text.cancel} disabled={saving} onClick={onClose}>×</button></header><form className="daily-sales-dialog__form" onSubmit={(event) => void submit(event)}><label>{text.paymentDate}<BaseerDatePicker language={language} label={text.paymentDate} max={defaultBusinessDate} value={businessDate} onChange={setBusinessDate} /></label><label>{text.paymentChannel}<select required value={vaultId} onChange={(event) => setVaultId(event.target.value)}><option value="">{text.selectVault}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select></label><label>{text.repaymentAmount} (SAR)<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>{error ? <p className="daily-sales-message error">{error}</p> : null}<footer className="daily-sales-dialog__actions"><BaseerButton variant="primary" disabled={saving}>{saving ? text.saving : text.recordSettlement}</BaseerButton></footer></form></section></div>;
}
