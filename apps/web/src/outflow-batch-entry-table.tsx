import { BaseerButton } from "./baseer-button";
import { BaseerSearchSelect } from "./baseer-search-select";
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
    { id: "row", header: text.rowNumber, width: "3.25rem", align: "center", className: "baseer-batch-entry-table__row", cell: (row) => rows.indexOf(row) + 1 },
    { id: "kind", header: text.invoiceType, width: "7.5rem", cell: (row) => allowedKinds.length === 1 ? <span>{typeLabel(row.kind)}</span> : <select aria-label={text.invoiceType} value={row.kind} onChange={(event) => onChange(row.id, "kind" as keyof Row, event.target.value as Row[keyof Row])}>{allowedKinds.map((kind) => <option key={kind} value={kind}>{typeLabel(kind)}</option>)}</select> },
    { id: "supplier", header: text.supplier, width: "11rem", cell: (row) => <BaseerSearchSelect id={`supplier-${row.id}`} label={text.supplier} value={row.supplierId} placeholder={row.settlementKind === "PAYABLE" ? text.selectSupplier : text.optional} options={suppliers.map((supplier) => ({ id: supplier.id, label: displayName(language, supplier) }))} onChange={(supplierId) => onSupplierChange(row.id, supplierId)} /> },
    { id: "category", header: text.financialCategory, width: "11rem", cell: (row) => <BaseerSearchSelect id={`category-${row.id}`} label={text.financialCategory} required value={row.categoryId} placeholder={text.selectCategory} options={categories.filter((category) => category.kind === row.kind).map((category) => ({ id: category.id, label: displayName(language, category) }))} onChange={(categoryId) => onChange(row.id, "categoryId" as keyof Row, categoryId as Row[keyof Row])} /> },
    { id: "invoice", header: text.invoiceNumber, width: "9rem", cell: (row) => <input aria-label={text.invoiceNumber} value={row.invoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => onChange(row.id, "invoiceNumber" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "invoiceDate", header: text.supplierInvoiceDate, width: "8.25rem", cell: (row) => <input aria-label={text.supplierInvoiceDate} type="date" max={maxInvoiceDate} value={row.supplierInvoiceDate} onChange={(event) => onChange(row.id, "supplierInvoiceDate" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "amount", header: text.totalAmount, width: "8rem", numeric: true, cell: (row) => <input aria-label={text.totalAmount} required inputMode="decimal" placeholder={text.enterAmount} value={row.grossAmount} onChange={(event) => onChange(row.id, "grossAmount" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "taxAmount", header: text.tax, width: "6.5rem", numeric: true, cell: (row) => {
      const amount = row.isTaxable && vatEnabled ? inclusiveTaxAmount(row.grossAmount, vatRateBasisPoints) : null;
      return amount === null ? null : <span>{amount.toFixed(2)}</span>;
    } },
    { id: "settlement", header: text.settlement, width: "7rem", cell: (row) => <select aria-label={text.settlement} value={row.settlementKind} onChange={(event) => onChange(row.id, "settlementKind" as keyof Row, event.target.value as Row[keyof Row])}><option value="PAID">{text.paid}</option><option value="PAYABLE">{text.payable}</option></select> },
    { id: "vault", header: text.paymentChannel, width: "9.5rem", cell: (row) => <BaseerSearchSelect id={`vault-${row.id}`} label={text.paymentChannel} disabled={row.settlementKind !== "PAID"} value={row.vaultId} placeholder={text.selectChannel} options={vaults.map((vault) => ({ id: vault.id, label: displayName(language, vault) }))} onChange={(vaultId) => onChange(row.id, "vaultId" as keyof Row, vaultId as Row[keyof Row])} /> },
    { id: "tax", header: `${text.tax} %`, width: "4.75rem", align: "center", cell: (row) => <BaseerButton aria-label={row.isTaxable ? text.taxOn : text.taxOff} title={row.isTaxable ? text.taxOn : text.taxOff} className="baseer-batch-entry-table__tax" disabled={!vatEnabled} type="button" variant="secondary" onClick={() => onChange(row.id, "isTaxable" as keyof Row, (!row.isTaxable) as Row[keyof Row])}>{row.isTaxable && vatEnabled ? taxRate : "—"}</BaseerButton> },
    { id: "remove", header: "", width: "3.5rem", align: "center", cell: (row) => <BaseerButton aria-label={text.removeRow} type="button" variant="secondary" className="baseer-batch-entry-table__remove" disabled={rows.length === 1} onClick={() => onRemove(row.id)}>×</BaseerButton> },
  ]} />;
}
function inclusiveTaxAmount(amount: string, rate: number) {
  const gross = +amount;
  return gross > 0 && Number.isFinite(gross) && rate > 0 ? gross * rate / (1e4 + rate) : null;
}
