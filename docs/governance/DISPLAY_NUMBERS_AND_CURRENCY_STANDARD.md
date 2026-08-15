# Display Numbers and Currency Standard

**Status:** Mandatory presentation policy  
**Applies to:** All Baseer ERP web/mobile screens, cards, tables, charts, reports, exports designed for on-screen use, API display projections, and shared formatting components.

## 1. Principle

Financial precision belongs to the authoritative backend and database. Display is a separate, centrally controlled server projection. The browser never rounds, truncates, formats, aggregates, or derives a business number.

## 2. Visible number rules

- All visible digits use English numerals: `0 1 2 3 4 5 6 7 8 9`, in both Arabic and English interfaces.
- Amounts and ordinary numeric measures display with **zero decimal places**.
- Percentages are the sole normal exception: they display with **one decimal place** only, for example `8.4%`.
- Negative values retain their negative sign, for example `-125`; the zero-decimal policy does not hide a negative balance.
- Empty/unavailable values use a central neutral representation such as `—`; they never become an invented zero.
- The policy applies equally to tables, cards, charts, dashboards, reports, dialogs, receipts, filters, and exports intended for visual use unless a legally required document template has an explicit approved exception.

## 3. Currency label rules

- Do **not** append or prepend `ر.س`, `ريال`, `SR`, or `SAR` to individual amounts in cards, tables, charts, or reports.
- The application assumes the selected company’s configured base currency within a financial view. If a currency context is needed, show it once in the page/report context or filter metadata, not beside every figure.
- A future multi-currency workflow must identify the currency through a dedicated column/header/context rule approved by product policy; it must not reintroduce repeated `SR`/`ر.س` suffixes.

## 4. Server display contract

For every displayed metric, the backend returns the precomputed display projection. Conceptually:

```ts
type MoneyDisplay = {
  raw: string;          // exact Decimal transport value; never used for UI math
  display: string;      // server-formatted integer, e.g. "115"
  sign: 'positive' | 'negative' | 'zero';
};

type PercentageDisplay = {
  raw: string;
  display: string;      // server-formatted one-decimal value, e.g. "8.4%"
};
```

The exact contract may vary by API version, but these rules may not: the server controls rounding and produces all visible display values; UI components render `display` only.

## 5. Rounding and reconciliation

- The backend retains exact Decimal values for accounting, tax, reconciliation, exports requiring precision, and audit.
- The central backend formatting policy defines the rounding mode once and applies it consistently. Individual screens may not choose their own mode.
- Totals, rows, cards, and charts are each server-projected. The UI never sums rounded rows to create a displayed total.
- If rounding causes a visible difference between individually rounded rows and a rounded total, the server remains authoritative and may provide a centrally worded reconciliation note where needed.
- This display rule never changes ledger postings, VAT calculations, serials, imported values, or stored document amounts.

## 6. Component requirements

- `MoneyAmount` renders the server `display` text only; it has no currency suffix/prefix option for cards, tables, charts, or reports.
- `Percentage` renders the server `display` text only and cannot choose a local decimal precision.
- Shared table, chart, export-preview, card, and report components must reject raw JavaScript number formatting for business metrics.
- Screens do not call locale number-format APIs for financial/business values; only the approved central display adapter renders server display values.

## 7. Acceptance checks

Every financial/reporting UI review verifies:

1. No visible amount has decimal places.
2. No visible percentage has more or fewer than one decimal place, unless its server receipt explicitly represents an unavailable value.
3. No `ر.س`, `ريال`, `SR`, or `SAR` appears beside individual amount values in cards, tables, charts, or reports.
4. Arabic and English views both use English digits.
5. Negative signs and empty values remain semantically correct.
6. No calculation or rounding occurs in React/client adapters.

