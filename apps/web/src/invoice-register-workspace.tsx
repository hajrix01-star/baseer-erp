import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerPeriodFilter, baseerPeriodLabel, baseerPeriodQuery, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { DataTable, type DataTableColumn } from "./data-table";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { financeText } from "./finance-copy";
import { formatMoney } from "./number-format";
import { presentBaseerApiError } from "./baseer-api-error";

type Language = "ar" | "en";
type Option = { id: string; nameAr: string; nameEn: string | null };
type InvoiceKind = "SALE" | "PURCHASE" | "EXPENSE" | "OBLIGATION" | "OTHER";
type FinancialDocumentKind = Extract<InvoiceKind, "SALE" | "PURCHASE" | "EXPENSE">;
type InvoiceStatus = "POSTED" | "CANCELLED";
type OperationFamily = "SALES" | "PURCHASES" | "EXPENSES" | "SUPPLIER_SETTLEMENTS" | "EMPLOYEE_OPERATIONS" | "FINANCING" | "OTHER";
type OperationClass = "SALE_COLLECTION" | "PURCHASE_INVOICE" | "EXPENSE_INVOICE" | "RECURRING_EXPENSE" | "SUPPLIER_SETTLEMENT" | "PAYROLL_ACCRUAL" | "PAYROLL_PAYMENT" | "EMPLOYEE_ADVANCE" | "EMPLOYEE_ADVANCE_SETTLEMENT" | "FINAL_SETTLEMENT_ACCRUAL" | "FINAL_SETTLEMENT_PAYMENT" | "LOAN_OPENING" | "LOAN_REPAYMENT" | "GENERAL_JOURNAL";
type MovementSource = "DAILY_SALES" | "OUTFLOW_DOCUMENT" | "SUPPLIER_DUE_PAYMENT" | "LOAN_OPENING" | "LOAN_REPAYMENT" | "JOURNAL";
type PayrollAccrual = { grossExpense: string; advanceSettlement: string; administrativeRecovery: string; netPayable: string };
type Movement = { id: string; source: MovementSource; sourceType: string; documentNumber: string; displayLabelAr: string; displayLabelEn: string; businessDate: string; supplierInvoiceDate: string | null; kind: InvoiceKind; operationFamily: OperationFamily; operationClass: OperationClass; settlementKind: "PAID" | "PAYABLE" | null; status: InvoiceStatus; supplier: Option | null; category: Option | null; grossAmount: string; netAmount: string; vatAmount: string; payrollAccrual: PayrollAccrual | null; journalEntryId: string; batchNumber: string | null; notes: string | null; recurring: boolean; createdAt: string };
type Receipt = { companyId: string; appliedPeriod: { fromBusinessDate: string | null; toBusinessDate: string | null; businessMonths: string[] }; summary: { documentCount: number; postedCount: number; cancelledCount: number; salesCount: number; purchaseCount: number; expenseCount: number; obligationCount: number; otherCount: number; paidCount: number; payableCount: number }; filters: { suppliers: Option[]; categories: Option[] }; records: Movement[]; hasMore: boolean; nextCursor: string | null };
type MovementDetail = { movement: Movement; journal: { id: string; sourceType: string; sourceReference: string; displayLabelAr: string; displayLabelEn: string; displayReference: string; businessDate: string; description: string | null; status: "POSTED" | "REVERSED"; postedAt: string; reversalOfEntryId: string | null; reversalEntryId: string | null; lines: Array<{ id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debitAmount: string; creditAmount: string; description: string | null }> }; allocations: Array<{ vaultId: string; vaultNameAr: string; vaultNameEn: string; paymentMethod: string; grossAmount: string }>; batch: { batchNumber: string; documentCount: number; grossAmount: string; netAmount: string; vatAmount: string; notes: string | null } | null; sourceDetail: { supplierInvoiceNumber: string | null; supplierInvoiceMissingReason: string | null; coverageLabel: string | null } };
type Filters = { kinds: FinancialDocumentKind[]; operationClasses: OperationClass[]; supplierIds: string[]; categoryIds: string[]; statuses: InvoiceStatus[]; q: string };
type MultiFilterKey = "kinds" | "operationClasses" | "supplierIds" | "categoryIds" | "statuses";
const emptyFilters: Filters = { kinds: [], operationClasses: [], supplierIds: [], categoryIds: [], statuses: [], q: "" };
const BaseerFilterAutocomplete = lazy(async () => ({ default: (await import("./baseer-filter-autocomplete")).BaseerFilterAutocomplete }));
const BaseerFilterBar = lazy(async () => ({ default: (await import("./baseer-filter-bar")).BaseerFilterBar }));

export function InvoiceRegisterWorkspace({ language }: { language: Language }) {
  const text = financeText(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Movement | null>(null);
  const [detail, setDetail] = useState<MovementDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailPane, setDetailPane] = useState<"operation" | "journal">("operation");
  const selectText = (value: string) => setFilters((current) => ({ ...current, q: value }));
  const selectValues = (key: MultiFilterKey, values: string[]) => setFilters((current) => ({ ...current, [key]: values } as Filters));

  const load = useCallback(async (cursor?: string) => {
    const current = activeSession(); setSession(current); if (!current) return;
    const query = new URLSearchParams(baseerPeriodQuery(period));
    if (filters.kinds.length) query.set("kinds", filters.kinds.join(","));
    if (filters.operationClasses.length) query.set("operationClasses", filters.operationClasses.join(","));
    if (filters.supplierIds.length) query.set("supplierIds", filters.supplierIds.join(","));
    if (filters.categoryIds.length) query.set("categoryIds", filters.categoryIds.join(","));
    if (filters.statuses.length) query.set("statuses", filters.statuses.join(","));
    if (filters.q.trim()) query.set("q", filters.q.trim());
    if (cursor) query.set("cursor", cursor);
    const next = await api<Receipt>(current, `/finance/invoice-register?${query.toString()}`);
    setReceipt((previous) => cursor && previous ? { ...next, filters: previous.filters, records: [...previous.records, ...next.records] } : next);
  }, [period, filters]);
  useEffect(() => { void load().catch((error) => setMessage(presentBaseerApiError(error, language, text.invoiceRegister))); }, [language, load, text.invoiceRegister]);

  const optionName = (item: Option | null) => item ? (language === "ar" ? item.nameAr : item.nameEn || item.nameAr) : "—";
  const operationFamilyLabel = (family: OperationFamily) => operationLabels(language).family[family];
  const operationClassLabel = (operationClass: OperationClass) => operationLabels(language).operation[operationClass];
  const documentKindLabel = (kind: FinancialDocumentKind) => ({ SALE: text.sales, PURCHASE: text.purchases, EXPENSE: text.expenses } as const)[kind];
  const statusLabel = (status: InvoiceStatus) => status === "POSTED" ? text.posted : text.cancelled;
  const sourceLabel = (movement: Movement) => language === "ar" ? movement.displayLabelAr : movement.displayLabelEn;
  const clearFilters = () => { setFilters(emptyFilters); setPeriod(defaultBaseerPeriodRange()); };
  const openMovement = async (movement: Movement) => {
    const current = activeSession(); if (!current) return;
    setSelected(movement); setDetail(null); setDetailPane("operation"); setDetailBusy(true);
    try { setDetail(await api<MovementDetail>(current, `/finance/invoice-register/${movement.journalEntryId}`)); }
    catch (error) { setMessage(presentBaseerApiError(error, language, text.movementFile)); }
    finally { setDetailBusy(false); }
  };
  const closeMovement = () => { setSelected(null); setDetail(null); setDetailBusy(false); };

  const defaultPeriod = defaultBaseerPeriodRange();
  const hasCustomPeriod = period.preset !== defaultPeriod.preset || period.from !== defaultPeriod.from || period.to !== defaultPeriod.to || period.months.join(",") !== defaultPeriod.months.join(",");
  const appliedFilters = [
    ...(hasCustomPeriod ? [{ id: "period", label: baseerPeriodLabel(period, language), onRemove: () => setPeriod(defaultBaseerPeriodRange()) }] : []),
    ...(filters.q.trim() ? [{ id: "search", label: filters.q.trim(), onRemove: () => selectText("") }] : []),
    ...filters.kinds.map((value) => ({ id: `kind:${value}`, label: documentKindLabel(value), onRemove: () => selectValues("kinds", filters.kinds.filter((item) => item !== value)) })),
    ...filters.operationClasses.map((value) => ({ id: `operation:${value}`, label: operationClassLabel(value), onRemove: () => selectValues("operationClasses", filters.operationClasses.filter((item) => item !== value)) })),
    ...filters.supplierIds.map((value) => ({ id: `supplier:${value}`, label: optionName(receipt?.filters.suppliers.find((item) => item.id === value) ?? null), onRemove: () => selectValues("supplierIds", filters.supplierIds.filter((item) => item !== value)) })),
    ...filters.categoryIds.map((value) => ({ id: `category:${value}`, label: optionName(receipt?.filters.categories.find((item) => item.id === value) ?? null), onRemove: () => selectValues("categoryIds", filters.categoryIds.filter((item) => item !== value)) })),
    ...filters.statuses.map((value) => ({ id: `status:${value}`, label: statusLabel(value), onRemove: () => selectValues("statuses", filters.statuses.filter((item) => item !== value)) })),
  ];
  const documentKindOptions = (["SALE", "PURCHASE", "EXPENSE"] as const).map((id) => ({ id, label: documentKindLabel(id) }));
  const operationClassOptions = (["SALE_COLLECTION", "PURCHASE_INVOICE", "EXPENSE_INVOICE", "RECURRING_EXPENSE", "SUPPLIER_SETTLEMENT", "PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "EMPLOYEE_ADVANCE", "EMPLOYEE_ADVANCE_SETTLEMENT", "FINAL_SETTLEMENT_ACCRUAL", "FINAL_SETTLEMENT_PAYMENT", "LOAN_OPENING", "LOAN_REPAYMENT", "GENERAL_JOURNAL"] as const).map((id) => ({ id, label: operationClassLabel(id) }));
  const statusOptions = (["POSTED", "CANCELLED"] as const).map((id) => ({ id, label: statusLabel(id) }));
  const columns: DataTableColumn<Movement>[] = useMemo(() => [
    { id: "number", header: language === "ar" ? "رقم المستند / الحركة" : "Document / movement no.", cell: (item) => <button className="baseer-link-button invoice-register__number" type="button" dir="ltr" title={item.documentNumber} onClick={() => void openMovement(item)}>{item.documentNumber}</button> },
    { id: "date", header: text.documentDate, cell: (item) => item.businessDate },
    { id: "operation-type", header: language === "ar" ? "نوع العملية" : "Operation type", cell: (item) => <span className="daily-sales-badge">{item.kind === "SALE" || item.kind === "PURCHASE" || item.kind === "EXPENSE" ? documentKindLabel(item.kind) : "—"}</span> },
    { id: "operation-detail", header: language === "ar" ? "تفصيل العملية" : "Operation detail", cell: (item) => <span className="daily-sales-badge">{operationClassLabel(item.operationClass)}</span> },
    { id: "classification", header: language === "ar" ? "التصنيف الأب" : "Parent classification", cell: (item) => <span className="invoice-register__classification">{operationFamilyLabel(item.operationFamily)}</span> },
    { id: "supplier", header: text.supplier, cell: (item) => optionName(item.supplier) },
    { id: "category", header: text.financialCategory, cell: (item) => optionName(item.category) },
    { id: "batch", header: text.batchInvoices, cell: (item) => item.batchNumber ?? "—" },
    { id: "effect", header: text.operation, numeric: true, align: "end", cell: (item) => <OperationEffect movement={item} /> },
    { id: "status", header: text.status, cell: (item) => <span className={`daily-sales-badge ${item.status === "CANCELLED" ? "is-muted" : ""}`}>{statusLabel(item.status)}</span> },
  ], [language, receipt, text]);
  if (!session) return <DailySalesSignIn language={language} />;

  return <section className="daily-sales-workspace invoice-register-workspace" aria-label={text.invoiceRegister}>
    <header className="administration-section-heading"><div><p className="eyebrow">{text.finance}</p><h3>{text.invoiceRegister}</h3><p>{text.invoiceRegisterDescription}</p></div></header>
    <Suspense fallback={null}><BaseerFilterBar controlsPresentation="menu" language={language} search={filters.q} searchLabel={text.searchInvoices} searchPlaceholder={text.searchInvoices} onSearchChange={selectText} appliedFilters={appliedFilters} onClear={clearFilters} controls={<><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} /><BaseerFilterAutocomplete id="invoice-register-kind" label={language === "ar" ? "نوع العملية" : "Operation type"} placeholder={language === "ar" ? "المبيعات أو المشتريات أو المصروفات" : "Sales, purchases, or expenses"} values={filters.kinds} options={documentKindOptions} onChange={(values) => selectValues("kinds", values)} /><BaseerFilterAutocomplete id="invoice-register-class" label={language === "ar" ? "تفصيل العملية" : "Operation detail"} placeholder={language === "ar" ? "كل التفاصيل" : "All details"} values={filters.operationClasses} options={operationClassOptions} onChange={(values) => selectValues("operationClasses", values)} /><BaseerFilterAutocomplete id="invoice-register-supplier" label={text.supplier} placeholder={text.supplier} values={filters.supplierIds} options={(receipt?.filters.suppliers ?? []).map((item) => ({ id: item.id, label: optionName(item) }))} onChange={(values) => selectValues("supplierIds", values)} /><BaseerFilterAutocomplete id="invoice-register-category" label={text.financialCategory} placeholder={text.financialCategory} values={filters.categoryIds} options={(receipt?.filters.categories ?? []).map((item) => ({ id: item.id, label: optionName(item) }))} onChange={(values) => selectValues("categoryIds", values)} /><BaseerFilterAutocomplete id="invoice-register-status" label={text.status} placeholder={`${text.all} — ${text.status}`} values={filters.statuses} options={statusOptions} onChange={(values) => selectValues("statuses", values)} /></>} /></Suspense>
    {message ? <p className="daily-sales-message error">{message}</p> : null}
    {!receipt ? <BaseerCard><p>{text.loading}</p></BaseerCard> : <><BaseerSummaryMetricGrid><BaseerSummaryMetric label={text.matchingMovements} value={String(receipt.summary.documentCount)} /><BaseerSummaryMetric label={text.posted} value={String(receipt.summary.postedCount)} /><BaseerSummaryMetric label={text.cancelled} value={String(receipt.summary.cancelledCount)} /><BaseerSummaryMetric label={text.sales} value={String(receipt.summary.salesCount)} /><BaseerSummaryMetric label={text.purchases} value={String(receipt.summary.purchaseCount)} /><BaseerSummaryMetric label={text.expenses} value={String(receipt.summary.expenseCount)} /><BaseerSummaryMetric label={text.obligations} value={String(receipt.summary.obligationCount)} /><BaseerSummaryMetric label={text.otherMovements} value={String(receipt.summary.otherCount)} /></BaseerSummaryMetricGrid>{receipt.records.length ? <DataTable ariaLabel={text.invoiceRegister} caption={text.invoiceRegister} columns={columns} rows={receipt.records} rowKey={(item) => item.journalEntryId} /> : <BaseerCard><p>{text.noInvoices}</p></BaseerCard>}{receipt.hasMore && receipt.nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(receipt.nextCursor ?? undefined)}>{text.loadMore}</BaseerButton> : null}</>}
    <BaseerDialog open={selected !== null} language={language} title={detail?.movement.documentNumber ?? selected?.documentNumber ?? text.movementFile} onClose={closeMovement} footer={<BaseerButton type="button" onClick={closeMovement}>{text.cancel}</BaseerButton>}>
      {detailBusy || !detail ? <p>{text.loading}</p> : <MovementFile detail={detail} language={language} text={text} optionName={optionName} sourceLabel={sourceLabel} pane={detailPane} onPaneChange={setDetailPane} />}
    </BaseerDialog>
  </section>;
}

function MovementFile({ detail, language, text, optionName, sourceLabel, pane, onPaneChange }: { detail: MovementDetail; language: Language; text: ReturnType<typeof financeText>; optionName: (value: Option | null) => string; sourceLabel: (movement: Movement) => string; pane: "operation" | "journal"; onPaneChange: (value: "operation" | "journal") => void }) {
  const allocationColumns: DataTableColumn<MovementDetail["allocations"][number]>[] = [
    { id: "vault", header: text.vaults, cell: (item) => language === "ar" ? item.vaultNameAr : item.vaultNameEn },
    { id: "method", header: text.paymentMethod, cell: (item) => item.paymentMethod },
    { id: "amount", header: text.amount, numeric: true, align: "end", cell: (item) => formatMoney(item.grossAmount) },
  ];
  const journalColumns: DataTableColumn<MovementDetail["journal"]["lines"][number]>[] = [
    { id: "account", header: text.account, cell: (item) => `${item.accountCode} · ${language === "ar" ? item.accountNameAr : item.accountNameEn}` },
    { id: "debit", header: text.debit, numeric: true, align: "end", cell: (item) => formatMoney(item.debitAmount) },
    { id: "credit", header: text.creditAmount, numeric: true, align: "end", cell: (item) => formatMoney(item.creditAmount) },
  ];
  const movement = detail.movement;
  const operationAmounts = movement.payrollAccrual
    ? <><label>{text.payrollExpense}<output>{formatMoney(movement.payrollAccrual.grossExpense)}</output></label><label>{text.advanceSettlement}<output>{formatMoney(movement.payrollAccrual.advanceSettlement)}</output></label><label>{text.administrativeRecovery}<output>{formatMoney(movement.payrollAccrual.administrativeRecovery)}</output></label><label>{text.netPayrollPayable}<output>{formatMoney(movement.payrollAccrual.netPayable)}</output></label><label>{text.cashEffect}<output>{text.noCashMovement}</output></label></>
    : movement.source === "JOURNAL"
      ? <label>{text.amount}<output>{formatMoney(movement.grossAmount)}</output></label>
      : <><label>{text.net}<output>{formatMoney(movement.netAmount)}</output></label><label>{text.tax}<output>{formatMoney(movement.vatAmount)}</output></label><label>{text.totalAmount}<output>{formatMoney(movement.grossAmount)}</output></label></>;
  return <>
    <BaseerWorkspaceTabs ariaLabel={text.movementFile} idPrefix="financial-movement-file" activeId={pane} onChange={(value) => onPaneChange(value as "operation" | "journal")} tabs={[{ id: "operation", label: text.operation }, { id: "journal", label: text.journalEntry }]} />
    {pane === "operation" ? <div className="administration-form">
      <label>{text.documentSource}<output>{sourceLabel(movement)}</output></label><label>{text.documentDate}<output>{movement.businessDate}</output></label><label>{text.status}<output>{movement.status === "POSTED" ? text.posted : text.cancelled}</output></label><label>{text.supplier}<output>{optionName(movement.supplier)}</output></label><label>{text.financialCategory}<output>{optionName(movement.category)}</output></label><label>{text.settlement}<output>{movement.settlementKind === "PAYABLE" ? text.payable : movement.settlementKind === "PAID" ? text.paid : "—"}</output></label>{operationAmounts}<label>{text.notes}<output>{movement.notes ?? "—"}</output></label>
      {detail.sourceDetail.supplierInvoiceNumber ? <label>{text.supplierInvoiceReference}<output>{detail.sourceDetail.supplierInvoiceNumber}</output></label> : null}
      {detail.sourceDetail.supplierInvoiceMissingReason ? <label>{text.invoiceNumberMissingReason}<output>{detail.sourceDetail.supplierInvoiceMissingReason}</output></label> : null}
      {detail.sourceDetail.coverageLabel ? <label>{text.coverage}<output>{detail.sourceDetail.coverageLabel}</output></label> : null}
      {detail.batch ? <><label>{text.batchContext}<output>{detail.batch.batchNumber} · {detail.batch.documentCount}</output></label><label>{text.totalAmount}<output>{formatMoney(detail.batch.grossAmount)}</output></label></> : null}
      <section><h4>{text.allocations}</h4>{detail.allocations.length ? <DataTable ariaLabel={text.allocations} caption={text.allocations} columns={allocationColumns} rows={detail.allocations} rowKey={(item) => `${item.vaultId}:${item.paymentMethod}`} /> : <p>{text.noAllocations}</p>}</section>
    </div> : <div className="administration-form"><label>{text.documentSource}<output>{language === "ar" ? detail.journal.displayLabelAr : detail.journal.displayLabelEn}</output></label><label>{text.sourceReference}<output dir="ltr">{detail.journal.displayReference}</output></label><label>{text.documentDate}<output>{detail.journal.businessDate}</output></label><label>{text.postedAt}<output>{detail.journal.postedAt}</output></label><label>{text.status}<output>{detail.journal.status === "REVERSED" ? text.movementReversed : text.posted}</output></label><label>{text.notes}<output>{detail.journal.description ?? "—"}</output></label><section><h4>{text.journalLines}</h4><DataTable ariaLabel={text.journalLines} caption={text.journalLines} columns={journalColumns} rows={detail.journal.lines} rowKey={(item) => item.id} /></section></div>}
  </>;
}

function OperationEffect({ movement }: { movement: Movement }) {
  return <bdi>{formatMoney(movement.grossAmount)}</bdi>;
}

function operationLabels(language: Language) {
  if (language === "ar") return {
    family: {
      SALES: "المبيعات", PURCHASES: "المشتريات", EXPENSES: "المصروفات", SUPPLIER_SETTLEMENTS: "تسويات الموردين", EMPLOYEE_OPERATIONS: "عمليات الموظفين", FINANCING: "التمويل والقروض", OTHER: "قيود وتسويات أخرى",
    } satisfies Record<OperationFamily, string>,
    operation: {
      SALE_COLLECTION: "تحصيل مبيعات", PURCHASE_INVOICE: "فاتورة مشتريات", EXPENSE_INVOICE: "فاتورة مصروف", RECURRING_EXPENSE: "مصروف دوري", SUPPLIER_SETTLEMENT: "سداد التزام مورد", PAYROLL_ACCRUAL: "استحقاق مسير رواتب", PAYROLL_PAYMENT: "دفع رواتب", EMPLOYEE_ADVANCE: "إصدار سلفة موظف", EMPLOYEE_ADVANCE_SETTLEMENT: "تسوية سلفة موظف", FINAL_SETTLEMENT_ACCRUAL: "استحقاق نهاية خدمة", FINAL_SETTLEMENT_PAYMENT: "دفع نهاية خدمة", LOAN_OPENING: "إثبات قرض", LOAN_REPAYMENT: "سداد قرض", GENERAL_JOURNAL: "قيد أو تسوية أخرى",
    } satisfies Record<OperationClass, string>,
  };
  return {
    family: {
      SALES: "Sales", PURCHASES: "Purchases", EXPENSES: "Expenses", SUPPLIER_SETTLEMENTS: "Supplier settlements", EMPLOYEE_OPERATIONS: "Employee operations", FINANCING: "Financing & loans", OTHER: "Other journals & adjustments",
    } satisfies Record<OperationFamily, string>,
    operation: {
      SALE_COLLECTION: "Sales collection", PURCHASE_INVOICE: "Purchase invoice", EXPENSE_INVOICE: "Expense invoice", RECURRING_EXPENSE: "Recurring expense", SUPPLIER_SETTLEMENT: "Supplier settlement", PAYROLL_ACCRUAL: "Payroll accrual", PAYROLL_PAYMENT: "Payroll payment", EMPLOYEE_ADVANCE: "Employee advance issued", EMPLOYEE_ADVANCE_SETTLEMENT: "Employee advance settlement", FINAL_SETTLEMENT_ACCRUAL: "Final-settlement accrual", FINAL_SETTLEMENT_PAYMENT: "Final-settlement payment", LOAN_OPENING: "Loan opening", LOAN_REPAYMENT: "Loan repayment", GENERAL_JOURNAL: "Journal or adjustment",
    } satisfies Record<OperationClass, string>,
  };
}
