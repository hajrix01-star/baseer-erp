import { BaseerButton } from "./baseer-button";
import { DataTable } from "./data-table";
import { displayName } from "./baseer-localization";
import { financeText } from "./finance-copy";

export type OutflowBatchEntryRow = { id: string; kind: "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; categoryId: string; supplierId: string; invoiceNumber: string; supplierInvoiceDate: string; grossAmount: string; isTaxable: boolean; vaultId: string };
type Category = { id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" };
type Supplier = { id: string; nameAr: string; nameEn: string | null };
type Vault = { id: string; nameAr: string; nameEn: string };
type FinanceText = ReturnType<typeof financeText>;

/** Shared Noorix-style row grid. A row is one independently journal-posted invoice. */
export function OutflowBatchEntryTable<Row extends OutflowBatchEntryRow>({ language, text, ariaLabel, rows, categories, suppliers, vaults, vatEnabled, vatRateBasisPoints, allowedKinds, maxInvoiceDate, onChange, onSupplierChange, onRemove }: { language: "ar" | "en"; text: FinanceText; ariaLabel: string; rows: readonly Row[]; categories: readonly Category[]; suppliers: readonly Supplier[]; vaults: readonly Vault[]; vatEnabled: boolean; vatRateBasisPoints: number; allowedKinds: readonly Row["kind"][]; maxInvoiceDate?: string; onChange: <K extends keyof Row>(id: string, key: K, value: Row[K]) => void; onSupplierChange: (id: string, supplierId: string) => void; onRemove: (id: string) => void }) {
  const taxRate = `${vatRateBasisPoints / 100}%`;
  const typeLabel = (kind: Row["kind"]) => kind === "PURCHASE" ? text.purchaseInvoice : text.expenseInvoice;
  return <DataTable ariaLabel={ariaLabel} caption={ariaLabel} className="baseer-batch-entry-table" rowKey={(row) => row.id} rows={rows} columns={[
    { id: "row", header: text.rowNumber, align: "center", className: "baseer-batch-entry-table__row", cell: (row) => rows.indexOf(row) + 1 },
    { id: "kind", header: text.invoiceType, cell: (row) => allowedKinds.length === 1 ? <span>{typeLabel(row.kind)}</span> : <select aria-label={text.invoiceType} value={row.kind} onChange={(event) => onChange(row.id, "kind" as keyof Row, event.target.value as Row[keyof Row])}>{allowedKinds.map((kind) => <option key={kind} value={kind}>{typeLabel(kind)}</option>)}</select> },
    { id: "supplier", header: text.supplier, cell: (row) => <select aria-label={text.supplier} value={row.supplierId} onChange={(event) => onSupplierChange(row.id, event.target.value)}><option value="">{row.settlementKind === "PAYABLE" ? text.selectSupplier : text.optional}</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{displayName(language, supplier)}</option>)}</select> },
    { id: "category", header: text.financialCategory, cell: (row) => <select aria-label={text.financialCategory} required value={row.categoryId} onChange={(event) => onChange(row.id, "categoryId" as keyof Row, event.target.value as Row[keyof Row])}><option value="">{text.selectCategory}</option>{categories.filter((category) => category.kind === row.kind).map((category) => <option key={category.id} value={category.id}>{displayName(language, category)}</option>)}</select> },
    { id: "invoice", header: text.invoiceNumber, cell: (row) => <input aria-label={text.invoiceNumber} value={row.invoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => onChange(row.id, "invoiceNumber" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "invoiceDate", header: text.supplierInvoiceDate, cell: (row) => <input aria-label={text.supplierInvoiceDate} type="date" max={maxInvoiceDate} value={row.supplierInvoiceDate} onChange={(event) => onChange(row.id, "supplierInvoiceDate" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "amount", header: text.totalAmount, numeric: true, cell: (row) => <input aria-label={text.totalAmount} required inputMode="decimal" placeholder={text.enterAmount} value={row.grossAmount} onChange={(event) => onChange(row.id, "grossAmount" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "taxAmount", header: text.tax, numeric: true, cell: (row) => {
      const amount = row.isTaxable && vatEnabled ? inclusiveTaxAmount(row.grossAmount, vatRateBasisPoints) : null;
      return amount === null ? null : <span>{amount.toFixed(2)}</span>;
    } },
    { id: "settlement", header: text.settlement, cell: (row) => <select aria-label={text.settlement} value={row.settlementKind} onChange={(event) => onChange(row.id, "settlementKind" as keyof Row, event.target.value as Row[keyof Row])}><option value="PAID">{text.paid}</option><option value="PAYABLE">{text.payable}</option></select> },
    { id: "vault", header: text.paymentChannel, cell: (row) => <select aria-label={text.paymentChannel} disabled={row.settlementKind !== "PAID"} value={row.vaultId} onChange={(event) => onChange(row.id, "vaultId" as keyof Row, event.target.value as Row[keyof Row])}><option value="">{text.selectChannel}</option>{vaults.map((vault) => <option key={vault.id} value={vault.id}>{displayName(language, vault)}</option>)}</select> },
    { id: "tax", header: `${text.tax} %`, align: "center", cell: (row) => <BaseerButton aria-label={row.isTaxable ? text.taxOn : text.taxOff} title={row.isTaxable ? text.taxOn : text.taxOff} className="baseer-batch-entry-table__tax" disabled={!vatEnabled} type="button" variant="secondary" onClick={() => onChange(row.id, "isTaxable" as keyof Row, (!row.isTaxable) as Row[keyof Row])}>{row.isTaxable && vatEnabled ? taxRate : "—"}</BaseerButton> },
    { id: "remove", header: "", align: "center", cell: (row) => <BaseerButton aria-label={text.removeRow} type="button" variant="secondary" className="baseer-batch-entry-table__remove" disabled={rows.length === 1} onClick={() => onRemove(row.id)}>×</BaseerButton> },
  ]} />;
}
function inclusiveTaxAmount(amount: string, rate: number) {
  const gross = +amount;
  return gross > 0 && Number.isFinite(gross) && rate > 0 ? gross * rate / (1e4 + rate) : null;
}
