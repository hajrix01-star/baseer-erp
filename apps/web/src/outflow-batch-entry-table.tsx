import type { ReactNode } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerSearchSelect } from "./baseer-search-select";
import { DataTable } from "./data-table";
import { displayName } from "./baseer-localization";
import { financeText, outflowBatchEntryText } from "./finance-copy";
import { formatNumber } from "./number-format";

export type OutflowBatchEntryRow = { id: string; kind: "" | "PURCHASE" | "EXPENSE"; settlementKind: "PAID" | "PAYABLE"; categoryId: string; supplierId: string; invoiceNumber: string; supplierInvoiceDate: string; grossAmount: string; isTaxable: boolean; assetWarrantyFollowUp?: boolean; vaultId: string; notes: string };
type Category = { id: string; nameAr: string; nameEn: string; kind: "PURCHASE" | "EXPENSE" };
type Supplier = { id: string; nameAr: string; nameEn: string | null; isFavorite?: boolean };
type Vault = { id: string; nameAr: string; nameEn: string };
type FinanceText = ReturnType<typeof financeText>;

/** Shared Noorix-style row grid. A row is one independently journal-posted invoice. */
export function OutflowBatchEntryTable<Row extends OutflowBatchEntryRow>({ language, text, ariaLabel, rows, categories, suppliers, vaults, vatEnabled, vatRateBasisPoints, allowedKinds, maxInvoiceDate, showAssetWarrantyFollowUp = false, onChange, onSupplierChange, remoteSupplierSearch, remoteCategorySearch, renderSupplierAction, onRemove }: { language: "ar" | "en"; text: FinanceText; ariaLabel: string; rows: readonly Row[]; categories: readonly Category[]; suppliers: readonly Supplier[]; vaults: readonly Vault[]; vatEnabled: boolean; vatRateBasisPoints: number; allowedKinds: readonly Row["kind"][]; maxInvoiceDate?: string; showAssetWarrantyFollowUp?: boolean; onChange: <K extends keyof Row>(id: string, key: K, value: Row[K]) => void; onSupplierChange: (id: string, supplierId: string) => void; remoteSupplierSearch?: (query: string) => Promise<readonly { id: string; label: string; isFavorite?: boolean }[]>; remoteCategorySearch?: (kind: Row["kind"], query: string) => Promise<readonly { id: string; label: string }[]>; renderSupplierAction?: (supplier: Supplier) => ReactNode; onRemove: (id: string) => void }) {
  const taxRate = `${vatRateBasisPoints / 100}%`;
  const typeLabel = (kind: Row["kind"]) => kind === "PURCHASE" ? text.purchaseInvoice : kind === "EXPENSE" ? text.expenseInvoice : text.invoiceType;
  const assetWarrantyLabel = outflowBatchEntryText(language).assetWarrantyFollowUp;
  const change = <K extends keyof Row>(row: Row, key: K, value: Row[K]) => onChange(row.id, key, value);
  const kindField = (row: Row) => allowedKinds.length === 1
    ? <span className="baseer-batch-entry-mobile__kind">{typeLabel(row.kind)}</span>
    : <BaseerSearchSelect searchable={false} id={`kind-${row.id}`} label={text.invoiceType} value={row.kind} placeholder={text.invoiceType} options={allowedKinds.map((kind) => ({ id: kind, label: typeLabel(kind) }))} onChange={(kind) => change(row, "kind" as keyof Row, kind as Row[keyof Row])} />;
  const supplierField = (row: Row) => {
    const selected = suppliers.find((supplier) => supplier.id === row.supplierId);
    const action = selected ? renderSupplierAction?.(selected) : null;
    return <div className="baseer-batch-entry__supplier" style={{ gridTemplateColumns: action ? "minmax(0, 1fr) 1.5rem" : "minmax(0, 1fr)" }}><BaseerSearchSelect id={`supplier-${row.id}`} label={text.supplier} value={row.supplierId} placeholder={row.settlementKind === "PAYABLE" ? text.selectSupplier : text.optional} options={suppliers.map((supplier) => ({ id: supplier.id, label: displayName(language, supplier), isFavorite: supplier.isFavorite }))} remoteSearch={remoteSupplierSearch} onChange={(supplierId) => onSupplierChange(row.id, supplierId)} />{action}</div>;
  };
  const categoryField = (row: Row) => <BaseerSearchSelect id={`category-${row.id}`} label={text.financialCategory} value={row.categoryId} placeholder={text.selectCategory} options={categories.filter((category) => category.kind === row.kind).map((category) => ({ id: category.id, label: displayName(language, category) }))} remoteSearch={row.kind && remoteCategorySearch ? (query) => remoteCategorySearch(row.kind, query) : undefined} onChange={(categoryId) => change(row, "categoryId" as keyof Row, categoryId as Row[keyof Row])} />;
  const settlementField = (row: Row) => <BaseerSearchSelect searchable={false} id={`settlement-${row.id}`} label={text.settlement} value={row.settlementKind} placeholder={text.settlement} options={[{ id: "PAID", label: text.paid }, { id: "PAYABLE", label: text.payable }]} onChange={(settlementKind) => change(row, "settlementKind" as keyof Row, settlementKind as Row[keyof Row])} />;
  const vaultField = (row: Row) => <BaseerSearchSelect id={`vault-${row.id}`} label={text.paymentChannel} disabled={row.settlementKind !== "PAID"} value={row.vaultId} placeholder={text.selectChannel} options={vaults.map((vault) => ({ id: vault.id, label: displayName(language, vault) }))} onChange={(vaultId) => change(row, "vaultId" as keyof Row, vaultId as Row[keyof Row])} />;
  const taxField = (row: Row) => <BaseerButton aria-label={row.isTaxable ? text.taxOn : text.taxOff} title={row.isTaxable ? text.taxOn : text.taxOff} className="baseer-batch-entry-table__tax" disabled={!vatEnabled} type="button" variant="secondary" onClick={() => change(row, "isTaxable" as keyof Row, (!row.isTaxable) as Row[keyof Row])}>{row.isTaxable && vatEnabled ? taxRate : "—"}</BaseerButton>;
  return <>
    <div className="baseer-batch-entry-mobile" aria-label={ariaLabel}>
      {rows.map((row, index) => {
        const taxAmount = row.isTaxable && vatEnabled ? inclusiveTaxAmount(row.grossAmount, vatRateBasisPoints) : null;
        return <article key={row.id} className="baseer-batch-entry-mobile__card">
          <header>
            <div><span>{text.rowNumber} {index + 1}</span>{kindField(row)}</div>
            <BaseerButton aria-label={text.removeRow} type="button" variant="icon" className="baseer-batch-entry-mobile__remove" disabled={rows.length === 1} onClick={() => onRemove(row.id)}>×</BaseerButton>
          </header>
          <div className="baseer-batch-entry-mobile__fields">
            <label className="baseer-batch-entry-mobile__wide"><span>{text.supplier}</span>{supplierField(row)}</label>
            <label className="baseer-batch-entry-mobile__wide"><span>{text.financialCategory}</span>{categoryField(row)}</label>
            <label><span>{text.totalAmount}</span><input inputMode="decimal" placeholder={text.enterAmount} value={row.grossAmount} onChange={(event) => change(row, "grossAmount" as keyof Row, event.target.value as Row[keyof Row])} /></label>
            <div className="baseer-batch-entry-mobile__tax-value"><span>{text.vat}</span><strong>{taxAmount === null ? "—" : formatNumber(taxAmount)}</strong></div>
            <label><span>{text.settlement}</span>{settlementField(row)}</label>
            <label><span>{text.paymentChannel}</span>{vaultField(row)}</label>
          </div>
          <details className="baseer-batch-entry-mobile__details">
            <summary>{language === "ar" ? "بيانات الفاتورة والخيارات" : "Invoice details & options"}</summary>
            <div>
              <label><span>{text.invoiceNumber}</span><input value={row.invoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => change(row, "invoiceNumber" as keyof Row, event.target.value as Row[keyof Row])} /></label>
              <label><span>{text.supplierInvoiceDate}</span><input max={maxInvoiceDate} type="date" value={row.supplierInvoiceDate} onChange={(event) => change(row, "supplierInvoiceDate" as keyof Row, event.target.value as Row[keyof Row])} /></label>
              <label className="baseer-batch-entry-mobile__wide"><span>{text.notes}</span><input value={row.notes} placeholder={text.optional} onChange={(event) => change(row, "notes" as keyof Row, event.target.value as Row[keyof Row])} /></label>
              <label className="baseer-batch-entry-mobile__toggle"><span>{text.vat}</span>{taxField(row)}</label>
              {showAssetWarrantyFollowUp ? <label className="baseer-batch-entry-mobile__checkbox"><input type="checkbox" checked={Boolean(row.assetWarrantyFollowUp)} onChange={(event) => change(row, "assetWarrantyFollowUp" as keyof Row, event.target.checked as Row[keyof Row])} />{assetWarrantyLabel}</label> : null}
            </div>
          </details>
        </article>;
      })}
    </div>
    <DataTable ariaLabel={ariaLabel} caption={ariaLabel} className="baseer-batch-entry-table" rowKey={(row) => row.id} rows={rows} columns={[
    { id: "row", header: text.rowNumber, width: "2.75rem", align: "center", className: "baseer-batch-entry-table__row", cell: (row) => rows.indexOf(row) + 1 },
    { id: "kind", header: text.invoiceType, width: "6.5rem", cell: kindField },
    { id: "supplier", header: text.supplier, width: "11rem", cell: supplierField },
    { id: "category", header: text.financialCategory, width: "9rem", cell: categoryField },
    { id: "invoice", header: text.invoiceNumber, width: "7.5rem", cell: (row) => <input aria-label={text.invoiceNumber} value={row.invoiceNumber} placeholder={text.supplierInvoiceNumber} onChange={(event) => onChange(row.id, "invoiceNumber" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "invoiceDate", header: text.supplierInvoiceDate, width: "7.75rem", cell: (row) => <input aria-label={text.supplierInvoiceDate} max={maxInvoiceDate} type="date" value={row.supplierInvoiceDate} onChange={(event) => onChange(row.id, "supplierInvoiceDate" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "notes", header: text.notes, width: "8rem", cell: (row) => <input aria-label={text.notes} value={row.notes} placeholder={text.optional} onChange={(event) => onChange(row.id, "notes" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "amount", header: text.totalAmount, width: "6.25rem", numeric: true, cell: (row) => <input aria-label={text.totalAmount} inputMode="decimal" placeholder={text.enterAmount} value={row.grossAmount} onChange={(event) => onChange(row.id, "grossAmount" as keyof Row, event.target.value as Row[keyof Row])} /> },
    { id: "taxAmount", header: text.vat, width: "4rem", numeric: true, cell: (row) => {
      const amount = row.isTaxable && vatEnabled ? inclusiveTaxAmount(row.grossAmount, vatRateBasisPoints) : null;
      return amount === null ? null : <span>{formatNumber(amount)}</span>;
    } },
    { id: "settlement", header: text.settlement, width: "6rem", cell: settlementField },
    { id: "vault", header: text.paymentChannel, width: "7.25rem", cell: vaultField },
    { id: "tax", header: `${text.vat} %`, width: "3rem", align: "center", cell: taxField },
    ...(showAssetWarrantyFollowUp ? [{ id: "assetWarranty", header: assetWarrantyLabel, width: "5.25rem", align: "center" as const, cell: (row: Row) => <input aria-label={assetWarrantyLabel} type="checkbox" checked={Boolean(row.assetWarrantyFollowUp)} onChange={(event) => onChange(row.id, "assetWarrantyFollowUp" as keyof Row, event.target.checked as Row[keyof Row])} /> }] : []),
    { id: "remove", header: "", width: "2.75rem", align: "center", cell: (row) => <BaseerButton aria-label={text.removeRow} type="button" variant="secondary" className="baseer-batch-entry-table__remove" disabled={rows.length === 1} onClick={() => onRemove(row.id)}>×</BaseerButton> },
  ]} />
  </>;
}
function inclusiveTaxAmount(amount: string, rate: number) {
  const gross = +amount;
  return gross > 0 && Number.isFinite(gross) && rate > 0 ? gross * rate / (1e4 + rate) : null;
}
