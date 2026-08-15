# Noorix Suppliers — Read-Only Discovery and BASEER Import Map

**Discovery date:** 2026-08-15  
**Source inspected:** `hajrix01-star/NOORIX`, pinned local reference `origin/main` at `94536fd3bf7e82135b065aaa20c9dd1e1d496464`  
**Scope:** source-code inspection only. No live Noorix data was viewed, exported, modified, or imported.

## Result in plain language

In Noorix, a supplier belongs to one company. The same real-world supplier may therefore appear separately in two companies, and that separation must remain true in BASEER ERP. Noorix also has a central ready-made directory, but it is an optional convenience for linking or creating a supplier inside a company; it is not the owner of company supplier data.

## Noorix supplier record

The company supplier contains:

| Noorix field / relationship | Import meaning in BASEER |
|---|---|
| `id` | preserved as immutable Noorix source ID, not reused as BASEER primary key |
| `tenantId`, `companyId` | mandatory company-isolation scope |
| Arabic / English name | preserve exactly as source display names |
| phone, tax number | preserve when present; normalize only for validation/search, never replace the source value silently |
| tax registration flag | preserve as source tax metadata |
| supplier type and category link | map to the BASEER company category/account mapping, with an exception if no safe map exists |
| bookmark | optional user-interface preference; import only if desired, never financial data |
| `isDeleted` | preserve as retired/archived source history; do not offer it for new documents |
| invoices, expense lines, assets, employee services and purchase-debt records | import through their own domains using the supplier source mapping |

Noorix checks that a nonempty tax number is not duplicated within the same active company. It permits suppliers with no tax number, so supplier names alone are not a safe universal identity.

## Deletion and history observed in Noorix

The normal supplier list excludes soft-deleted suppliers. A supplier cannot be deleted while it has an active invoice or active expense line; otherwise it is marked deleted rather than physically removed. This supports the same BASEER rule: historical supplier records and their document links remain intact.

## Optional central supplier directory

Noorix's `SupplierDirectoryEntry` is global seed/reference data with a code, multilingual names, aliases, default category code, tax attributes, and whether a supplier invoice number is required. Each company can link at most one of its suppliers to a directory entry.

When Noorix tries to connect a directory item, it first uses an existing explicit link. Otherwise it compares normalized names and aliases. If two candidates are too close, it stops and asks for resolution rather than choosing one automatically.

This proves two import requirements for BASEER:

1. A directory match is a convenience suggestion, never a migration identity rule.
2. No fuzzy/name-based automatic merge is permitted during migration; any ambiguous match goes to an exception report for owner review.

## Required BASEER import order

1. Create or map the target company under the correct isolated tenant.
2. Import its categories/accounts needed by supplier categories.
3. Import every Noorix supplier as a company-scoped BASEER supplier, including inactive/deleted historical suppliers where document references require them.
4. Store an idempotent source map: source system, tenant/company, Noorix supplier ID, BASEER supplier ID, source state, and import run.
5. Import purchase invoices, expense lines, assets, employee-service references, and supplier dues using that source map.
6. Reconcile supplier count by company, active/retired count, tax-number duplicates, and every unresolved category or directory suggestion before cutover.

## Mandatory migration safeguards

- The same supplier name in different companies must produce two isolated company records unless the owner later chooses a cross-company presentation feature. It must not share documents, dues, balances, or permissions.
- A missing tax number must not cause a merge. A duplicate active tax number in one company must stop the affected import row and appear in the exception report.
- Deleted/retired suppliers with historical documents must be imported as non-selectable for new transactions, not dropped.
- The original Noorix supplier ID, original name, tax number, category link, and source state must be retained in the migration audit trail.
- A current central directory may only be linked after import when the link is exact or owner-approved. It must not overwrite the imported supplier name, tax details, historical documents, or accounting category.
- Every financial document and due must resolve the supplier through the company-scoped source map; there is no fallback to a name search.

## Relationship to supplier dues

The Supplier Dues design remains valid. Noorix pending purchase-debt records reference a company supplier, and BASEER will import the due through this supplier source map. The separate cash-basis reporting rule is documented in [Supplier Dues and Cash-Basis Reporting — Gate A Decision](../foundation/SUPPLIER_DUES_CASH_BASIS_REPORTING_GATE_A_DECISION.md) and the prior [Noorix supplier-dues discovery](NOORIX_SUPPLIER_DUES_AND_PARTIAL_PAYMENTS_DISCOVERY_2026-08-15.md).

## Delivery gate

No live migration may start until the supplier import dry run proves: zero cross-company links, no automatic fuzzy merges, a complete source-ID map, explicit resolution of duplicates/category gaps, and successful reconciliation of all document and due references.

