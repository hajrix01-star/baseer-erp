import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerPeriodFilter, baseerPeriodLabel, baseerPeriodQuery, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { DataTable, type DataTableColumn } from "./data-table";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { formatMoney } from "./number-format";
import { financeText } from "./finance-copy";
import { presentBaseerApiError } from "./baseer-api-error";

type Language = "ar" | "en";
type Option = { id: string; nameAr: string; nameEn: string | null };
type InvoiceKind = "SALE" | "PURCHASE" | "EXPENSE" | "OBLIGATION" | "OTHER";
type InvoiceStatus = "POSTED" | "CANCELLED";
type Invoice = { id: string; source: "DAILY_SALES" | "OUTFLOW_DOCUMENT" | "SUPPLIER_DUE_PAYMENT" | "LOAN_OPENING" | "LOAN_REPAYMENT" | "JOURNAL"; sourceType: string; documentNumber: string; businessDate: string; supplierInvoiceDate: string | null; kind: InvoiceKind; settlementKind: "PAID" | "PAYABLE" | null; status: InvoiceStatus; supplier: Option | null; category: Option | null; grossAmount: string; netAmount: string; vatAmount: string; journalEntryId: string; batchNumber: string | null; notes: string | null; recurring: boolean; createdAt: string };
type Receipt = { companyId: string; appliedPeriod: { fromBusinessDate: string | null; toBusinessDate: string | null; businessMonths: string[] }; summary: { documentCount: number; salesCount: number; purchaseCount: number; expenseCount: number; obligationCount: number; otherCount: number; paidCount: number; payableCount: number; grossAmount: string; netAmount: string; vatAmount: string }; filters: { suppliers: Option[]; categories: Option[] }; records: Invoice[]; hasMore: boolean };
type Filters = { kinds: InvoiceKind[]; supplierIds: string[]; categoryIds: string[]; statuses: InvoiceStatus[]; q: string };
type MultiFilterKey = "kinds" | "supplierIds" | "categoryIds" | "statuses";
const emptyFilters: Filters = { kinds: [], supplierIds: [], categoryIds: [], statuses: [], q: "" };
const BaseerFilterAutocomplete = lazy(async () => ({ default: (await import("./baseer-filter-autocomplete")).BaseerFilterAutocomplete }));
const BaseerFilterBar = lazy(async () => ({ default: (await import("./baseer-filter-bar")).BaseerFilterBar }));

export function InvoiceRegisterWorkspace({ language }: { language: Language }) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const selectText = (value: string) => setFilters((current) => ({ ...current, q: value }));
  const selectValues = (key: MultiFilterKey, values: string[]) => setFilters((current) => ({ ...current, [key]: values } as Filters));

  const load = useCallback(async () => {
    const current = activeSession(); setSession(current); if (!current) return;
    const query = new URLSearchParams(baseerPeriodQuery(period));
    if (filters.kinds.length) query.set("kinds", filters.kinds.join(","));
    if (filters.supplierIds.length) query.set("supplierIds", filters.supplierIds.join(","));
    if (filters.categoryIds.length) query.set("categoryIds", filters.categoryIds.join(","));
    if (filters.statuses.length) query.set("statuses", filters.statuses.join(","));
    if (filters.q.trim()) query.set("q", filters.q.trim());
    setReceipt(await api<Receipt>(current, `/finance/invoice-register?${query.toString()}`));
  }, [period, filters]);
  useEffect(() => { void load().catch((error) => setMessage(presentBaseerApiError(error, language, text.invoiceRegister))); }, [language, load, text.invoiceRegister]);

  const optionName = (item: Option | null) => item ? (language === "ar" ? item.nameAr : item.nameEn || item.nameAr) : "—";
  const kindLabel = (kind: InvoiceKind) => kind === "SALE" ? text.sales : kind === "PURCHASE" ? text.purchases : kind === "EXPENSE" ? text.expenses : kind === "OBLIGATION" ? text.obligations : text.otherMovements;
  const statusLabel = (status: InvoiceStatus) => status === "POSTED" ? text.posted : text.cancelled;
  const clearFilters = () => { setFilters(emptyFilters); setPeriod(defaultBaseerPeriodRange()); };
  const defaultPeriod = defaultBaseerPeriodRange();
  const hasCustomPeriod = period.preset !== defaultPeriod.preset || period.from !== defaultPeriod.from || period.to !== defaultPeriod.to || period.months.join(",") !== defaultPeriod.months.join(",");
  const appliedFilters = [
    ...(hasCustomPeriod ? [{ id: "period", label: baseerPeriodLabel(period, language), onRemove: () => setPeriod(defaultBaseerPeriodRange()) }] : []),
    ...(filters.q.trim() ? [{ id: "search", label: filters.q.trim(), onRemove: () => selectText("") }] : []),
    ...filters.kinds.map((value) => ({ id: `kind:${value}`, label: kindLabel(value), onRemove: () => selectValues("kinds", filters.kinds.filter((item) => item !== value)) })),
    ...filters.supplierIds.map((value) => ({ id: `supplier:${value}`, label: optionName(receipt?.filters.suppliers.find((item) => item.id === value) ?? null), onRemove: () => selectValues("supplierIds", filters.supplierIds.filter((item) => item !== value)) })),
    ...filters.categoryIds.map((value) => ({ id: `category:${value}`, label: optionName(receipt?.filters.categories.find((item) => item.id === value) ?? null), onRemove: () => selectValues("categoryIds", filters.categoryIds.filter((item) => item !== value)) })),
    ...filters.statuses.map((value) => ({ id: `status:${value}`, label: statusLabel(value), onRemove: () => selectValues("statuses", filters.statuses.filter((item) => item !== value)) })),
  ];
  const kindOptions = (["SALE", "PURCHASE", "EXPENSE", "OBLIGATION", "OTHER"] as const).map((id) => ({ id, label: kindLabel(id) }));
  const statusOptions = (["POSTED", "CANCELLED"] as const).map((id) => ({ id, label: statusLabel(id) }));
  const columns: DataTableColumn<Invoice>[] = useMemo(() => [
    { id: "number", header: text.invoiceNumber, cell: (item) => <button className="baseer-link-button" type="button" onClick={() => setSelected(item)}>{item.documentNumber}</button> },
    { id: "date", header: text.documentDate, cell: (item) => item.businessDate }, { id: "kind", header: text.invoiceType, cell: (item) => <span className="daily-sales-badge">{kindLabel(item.kind)}{item.recurring ? ` · ${text.recurring}` : ""}</span> },
    { id: "supplier", header: text.supplier, cell: (item) => optionName(item.supplier) }, { id: "category", header: text.financialCategory, cell: (item) => optionName(item.category) }, { id: "invoiceDate", header: text.supplierInvoiceDate, cell: (item) => item.supplierInvoiceDate ?? "—" }, { id: "notes", header: text.notes, width: "12rem", cell: (item) => item.notes ? <span title={item.notes}>{item.notes}</span> : "—" },
    { id: "net", header: text.net, numeric: true, align: "end", cell: (item) => formatMoney(item.netAmount) }, { id: "tax", header: text.tax, numeric: true, align: "end", cell: (item) => formatMoney(item.vatAmount) }, { id: "total", header: text.totalAmount, numeric: true, align: "end", cell: (item) => formatMoney(item.grossAmount) }, { id: "status", header: text.status, cell: (item) => <span className={`daily-sales-badge ${item.status === "CANCELLED" ? "is-muted" : ""}`}>{statusLabel(item.status)}</span> },
  ], [language, text]);
  if (!session) return <DailySalesSignIn language={language} />;

  return <section className="daily-sales-workspace invoice-register-workspace" aria-label={text.invoiceRegister}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.invoiceRegister}</h3></div></header>
    <Suspense fallback={null}><BaseerFilterBar controlsPresentation="menu" language={language} search={filters.q} searchLabel={text.searchInvoices} searchPlaceholder={text.searchInvoices} onSearchChange={selectText} appliedFilters={appliedFilters} onClear={clearFilters} controls={<><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} /><BaseerFilterAutocomplete id="invoice-register-kind" label={text.invoiceType} placeholder={`${text.all} — ${text.invoiceType}`} values={filters.kinds} options={kindOptions} onChange={(values) => selectValues("kinds", values)} /><BaseerFilterAutocomplete id="invoice-register-supplier" label={text.supplier} placeholder={text.supplier} values={filters.supplierIds} options={(receipt?.filters.suppliers ?? []).map((item) => ({ id: item.id, label: optionName(item) }))} onChange={(values) => selectValues("supplierIds", values)} /><BaseerFilterAutocomplete id="invoice-register-category" label={text.financialCategory} placeholder={text.financialCategory} values={filters.categoryIds} options={(receipt?.filters.categories ?? []).map((item) => ({ id: item.id, label: optionName(item) }))} onChange={(values) => selectValues("categoryIds", values)} /><BaseerFilterAutocomplete id="invoice-register-status" label={text.status} placeholder={`${text.all} — ${text.status}`} values={filters.statuses} options={statusOptions} onChange={(values) => selectValues("statuses", values)} /></>} /></Suspense>
    {message ? <p className="daily-sales-message error">{message}</p> : null}
    {!receipt ? <BaseerCard><p>{text.loading}</p></BaseerCard> : <><div className="administration-role-cards"><Metric label={text.invoiceCount} value={String(receipt.summary.documentCount)} /><Metric label={text.sales} value={String(receipt.summary.salesCount)} /><Metric label={text.purchases} value={String(receipt.summary.purchaseCount)} /><Metric label={text.expenses} value={String(receipt.summary.expenseCount)} /><Metric label={text.obligations} value={String(receipt.summary.obligationCount)} /><Metric label={text.otherMovements} value={String(receipt.summary.otherCount)} /><Metric label={text.totalAmount} value={formatMoney(receipt.summary.grossAmount)} /><Metric label={text.tax} value={formatMoney(receipt.summary.vatAmount)} /></div>{receipt.records.length ? <DataTable ariaLabel={text.invoiceRegister} caption={text.invoiceRegister} columns={columns} rows={receipt.records} rowKey={(item) => item.id} /> : <BaseerCard><p>{text.noInvoices}</p></BaseerCard>}{receipt.hasMore ? <p className="empty-results">{text.resultLimit}</p> : null}</>}
    <BaseerDialog open={selected !== null} language={language} title={selected?.documentNumber ?? text.invoiceRegister} onClose={() => setSelected(null)}>{selected ? <dl className="invoice-register-workspace__detail"><div><dt>{text.documentDate}</dt><dd>{selected.businessDate}</dd></div><div><dt>{text.invoiceType}</dt><dd>{kindLabel(selected.kind)}</dd></div><div><dt>{text.supplier}</dt><dd>{optionName(selected.supplier)}</dd></div><div><dt>{text.financialCategory}</dt><dd>{optionName(selected.category)}</dd></div><div><dt>{text.net}</dt><dd>{formatMoney(selected.netAmount)}</dd></div><div><dt>{text.tax}</dt><dd>{formatMoney(selected.vatAmount)}</dd></div><div><dt>{text.totalAmount}</dt><dd>{formatMoney(selected.grossAmount)}</dd></div><div><dt>{text.notes}</dt><dd>{selected.notes ?? "—"}</dd></div></dl> : null}</BaseerDialog>
  </section>;
}
function Metric({ label, value }: { label: string; value: string }) { return <BaseerCard padding="compact"><small>{label}</small><strong>{value}</strong></BaseerCard>; }
