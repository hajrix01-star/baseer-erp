# Noorix document-number compatibility map for BASEER ERP

**Status:** Gate A discovery complete; implementation is a mandatory Finance gate requirement.

## Decision

BASEER ERP will preserve every imported Noorix invoice number exactly as displayed. For new invoices after cutover, BASEER ERP will continue the same visible format and the next available sequence for the same company, prefix, and business date.

This preserves user search, printed references, audit trails, linked records, and the expected continuation from Noorix. A historical number is never silently renumbered.

## Evidence found in Noorix source (read-only)

| Evidence | Observed rule |
|---|---|
| `backend/src/common/utils/invoice-serial.ts` | System-generated invoice format is `{PREFIX}-{YYYYMMDD}-{SEQ}`. The visible sequence is zero-padded to at least three digits. |
| Same generator | The legacy counter scope is company + prefix + transaction date. It counts matching existing numbers and generates the next displayed suffix. |
| `backend/prisma/schema.prisma`, `Invoice` | `invoiceNumber` is unique per `companyId`, including across invoice kinds. `supplierInvoiceNumber` is a separate supplier reference and must not replace the Baseer document number. |
| Financial services | A supplied `invoiceNumber` is retained instead of generating a new value; this is the required import path. |

## Prefix map

| Noorix kind | Legacy prefix | BASEER ERP series key | Meaning |
|---|---:|---|---|
| `purchase` | `PUR` | `INVOICE:PUR` | Purchase invoice |
| `expense`, `fixed_expense` | `EXP` | `INVOICE:EXP` | Expense invoice |
| `hr_expense` | `HR` | `INVOICE:HR` | HR expense invoice |
| `salary`, `sale` | `SAL` | `INVOICE:SAL` | Salary or sale invoice using Noorix's shared visible series |
| `advance` | `ADV` | `INVOICE:ADV` | Employee advance invoice |
| unrecognised legacy kind | `INV` | `INVOICE:INV` | Exception-only route; must appear in the migration exception report before import |

The shared `SAL` prefix is intentional compatibility behaviour: BASEER ERP must scope its counter by **visible prefix**, not merely by accounting kind. Otherwise a sale and a salary record from the same company and date could receive conflicting legacy-format numbers.

## BASEER ERP implementation rule

BASEER ERP already has an atomic `DocumentSerialCounter` scoped by tenant, company, series, and business date. The Finance module must:

1. map the document kind to the series key above;
2. reserve the next value atomically with `DocumentSerialService` in the same transaction as the document;
3. format it as `{PREFIX}-{YYYYMMDD}-{SEQ}`, with `SEQ` padded to at least three digits;
4. retain cancelled imported documents in the sequence so their number is never reused;
5. keep a non-visible migration identity map using the Noorix invoice ID, company, source checksum, and import-run ID.

For an import, the counter for each `(company, visible prefix, date)` is seeded to the **highest parsed suffix among valid imported numbers**, not to the row count. This is safer than Noorix's historic count-based generator when there are gaps or cancelled records.

## Mandatory migration validation before importing real data

For every company and prefix/date group, the rehearsal must report and stop on:

- duplicate `invoiceNumber` values within a company;
- a number that does not match the expected legacy format;
- a non-numeric or ambiguous suffix;
- a supplied invoice number that conflicts with an already imported Baseer document;
- a counter whose stored value is lower than the highest imported suffix;
- an unknown legacy kind or an unexpected prefix.

The reconciliation receipt must show, per company and series: source count, imported count, duplicate count, highest imported suffix, seeded next value, and a checksum of the source IDs. Any exception is returned to the owner for approval; it is never auto-renumbered.

## Boundaries

This mapping was extracted from Noorix code only. It has not queried, copied, or changed any Noorix data. A later read-only export/rehearsal will confirm whether existing records contain historical exceptions before any real import.

No Finance document tables or Noorix data import are created by this discovery step. Their implementation remains blocked until the operational Gate C evidence is completed.
