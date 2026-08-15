# Supplier Dues and Cash-Basis Reporting — Gate A Decision

**Decision status:** Owner approved — mandatory when supplier dues are delivered.  
**Approved:** 2026-08-15  
**Scope:** BASEER ERP private companies; each company is isolated.

**Noorix source check:** [read-only discovery of the Noorix staging register and invoice conversion path](../migration/NOORIX_SUPPLIER_DUES_AND_PARTIAL_PAYMENTS_DISCOVERY_2026-08-15.md). The check confirms that this BASEER rule is a deliberate extension: Noorix stages historical debts and converts them to fully paid purchase invoices, but does not model linked partial settlements.

## Decision

Baseer shall include supplier dues for purchases/services received now and paid later. A due is recorded against the supplier with its original source invoice, amount, business date, due status, and payment history.

For the owner's management workflow, an unpaid supplier due is **not counted** in the ordinary dashboard/report expense totals, daily/monthly cash movement, vault balances, or paid-purchase totals. It appears only in its own separate **Supplier Dues** view and report.

When a due is paid, the payment is counted in ordinary management expense/cash reports on the payment business date and is linked to the original supplier due.

## Required behavior

1. Creating an unpaid due does not reduce a vault balance or create a cash-outflow report entry.
2. A supplier-due record shows original document number, supplier, original date, original amount, paid amount, remaining amount, status, and linked payments.
3. Partial payments reduce the remaining due; only the paid amount enters ordinary management expense/cash reports.
4. A due that is cancelled or corrected preserves its original record and audit history.
5. Supplier-dues reports are separate from normal expense, sales, profit, and cash reports, and must be clearly labelled as outstanding commitments.
6. Any future tax-compliance or statutory-reporting module must use an explicitly approved tax rule; it must not silently reuse this personal management cash-basis rule.
7. Company isolation, authorized company context, fiscal-period policy, audit records, idempotency, and central filters apply to dues and payments.

## Example

An SAR 5,000 supplier bill dated 10 August is recorded as unpaid:

- Supplier Dues report: SAR 5,000 outstanding.
- Ordinary expense/cash dashboard for 10 August: SAR 0 from this bill.

If SAR 2,000 is paid on 20 August:

- Supplier Dues report: SAR 3,000 outstanding.
- Ordinary expense/cash dashboard for 20 August: SAR 2,000 paid expense/cash outflow.

## Delivery requirement

The supplier-dues delivery must prove that outstanding dues never leak into the ordinary report totals before payment, that linked partial payments are exact, and that the separate dues report reconciles every original due, payment, cancellation, and remaining balance.
