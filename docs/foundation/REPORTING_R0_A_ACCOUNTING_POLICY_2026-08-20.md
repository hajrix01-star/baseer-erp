# Reporting R0-A — Accounting Policy and Versioned P&L Mapping

**Status:** Implemented policy foundation; owner approval remains required before R0-B report-run consistency or any R1 report/API/UI release.
**Effective policy version:** `REPORTING_R0_A_2026_08_20`
**Scope:** Accounting-reporting policy and its durable mapping store only. This is not a Trial Balance endpoint, P&L, catalogue, report run, export, or browser screen. The personal-use scope currently defers any formal P&L release; see [Personal Reporting Scope Decision](PERSONAL_REPORTING_SCOPE_DECISION_2026-08-20.md).

## 1. Authority and boundary

`FinanceJournalEntry` and `FinanceJournalLine` are the financial source of truth. Financial reports only read eligible sealed ledger evidence. They never post, cancel, edit, or calculate financial totals in the browser.

The future report predicate is explicitly:

```text
tenant and authorised company match
AND FinanceJournalEntry.isSealed = true
AND FinanceJournalEntry.status IN (POSTED, REVERSED)
```

`REVERSED` does **not** remove the original from historical evidence. A reversal is a second sealed opposite entry, linked by `reversalOfEntryId`, and has its own `businessDate`. The linkage is audit evidence, not a reason to exclude either entry. A current status by itself must never rewrite an earlier economic date.

## 2. Trial Balance policy

For each eligible account and selected inclusive business-date period `[S, E]`, all sums remain at ledger precision (`DECIMAL(18,4)`) until presentation:

```text
D0 = Σ debit where businessDate < S       C0 = Σ credit where businessDate < S
PD = Σ debit where S ≤ businessDate ≤ E   PC = Σ credit where S ≤ businessDate ≤ E

openingDr = max(D0 - C0, 0)                openingCr = max(C0 - D0, 0)
closingDr = max(D0 + PD - C0 - PC, 0)      closingCr = max(C0 + PC - D0 - PD, 0)
```

The Trial Balance displays `opening Dr/Cr`, `period Dr/Cr`, and `closing Dr/Cr`. Across the full eligible chart of accounts, opening debit equals opening credit, period debit equals period credit, and closing debit equals closing credit. Rounding is display-only and must be disclosed in the later report header.

An archived account with historical movement remains eligible. System accounts remain eligible even when their balance is zero. Hiding zero rows is only a presentation option; it never changes totals or evidence.

## 3. Dates, period lifecycle, and cancellation

The reporting contract distinguishes four times:

| Concept | Meaning in R0-A |
| --- | --- |
| `businessDate` | Economic/accounting date of the ledger entry and its reversal. |
| Fiscal-period boundary | The selected `[S, E]`; period status does not recalculate old movements. |
| Posted watermark | What was committed when the report ran. R0-B persists the ledger revision/`ReportRun` boundary; a report API still must apply it to every row/evidence/output read. |
| Report-run time | When the view/output was created; separate from economic date. |

`OPEN` periods accept ordinary postings. `CLOSED` periods can reopen only with a reason and audit trail. `LOCKED` periods cannot reopen; correction is a new balanced adjustment/reversal in a valid later open period. Period lifecycle changes do not change the Trial Balance arithmetic or hide original/reversal evidence.

No report API exists yet. When Gate R0 uses R0-B's watermark, it may claim stable multi-page/export consistency only when every result/evidence/output query is constrained to the same stored run boundary.

## 4. Opening balances and retained earnings

Trial Balance opening is cumulative ledger movement before `S`; it does not manufacture an opening or closing journal entry. Closing is arithmetic ledger balance, not a fiscal-close posting.

`OPENING_BALANCE_CLEARING` and `RETAINED_EARNINGS` are distinct protected equity accounts. Retained earnings is excluded from P&L mapping and receives no automatic transfer of net profit in R0-A. A future fiscal-year close, if approved, must create a new sealed balanced entry with an explicit `fiscal_year_close` source, business date, approval/audit trail and documented P&L treatment; it must never rewrite prior entries or reuse opening-balance clearing as retained earnings.

## 5. Functional currency and scope

`CompanyFinanceProfile.functionalCurrencyCode` now persists an explicit uppercase ISO-4217-shaped code (initialised as `SAR`). It cannot change after the company has sealed journal evidence. Current amounts are implicitly in that single functional currency.

R1 is restricted to one authorised company and its functional currency. There is no foreign-currency amount, FX rate, translation, revaluation, consolidation, or claim of multi-currency support. A future report header discloses currency once, alongside the display rounding rule.

## 6. Versioned P&L presentation mapping

The policy store contains a company- and tenant-isolated three-layer map:

```text
FinancePnlMappingVersion (effective dates, policy version, approval, checksum)
  -> FinancePnlStatementLine (stable line, names, order, presentation nature)
    -> FinancePnlAccountMapping (one account -> one line, explicit debit/credit presentation sign)
```

The permitted presentation natures are revenue, cost of sales, operating income, operating expense, investing, financing, income tax, and discontinued operations. Subtotals are declared as lines but receive no direct account mapping. The intended future sequence is revenue → cost of sales → gross profit → operating income/expense → operating profit → investing → profit before financing and income taxes → financing → income taxes → profit. This is presentation direction only; Baseer does not claim IFRS compliance.

A mapping is drafted, then approved with a SHA-256 checksum and audit record. Approval requires every active revenue/expense account in the company to map exactly once, in the same company/version, to a compatible non-subtotal line. Only revenue and expense accounts may be mapped; this excludes VAT controls, advances, supplier dues/settlements, cash/vault/bank movement, capital, owner/current accounts, retained earnings and all other balance-sheet accounts. The mapping tables have tenant RLS, cross-version guardrails, and immutable lines/mappings after approval. A successor version supersedes the predecessor; it does not edit its lines or mappings.

No mapping is auto-seeded from `FinanceCategory`, account codes, or system keys: those facts do not safely determine cost-of-sales versus operating/investing/financing presentation. Approval is therefore deliberately an accounting-owner action in a later authorised administration command; R0-A exposes no API or UI to perform it.

R0-B must persist the approved mapping version ID and checksum in each `ReportRun`. A later mapping version cannot restate a frozen historical report. A restatement is a new disclosed run, never a mutation of an old mapping or output.

## 7. Explicit formal-P&L exclusions and release gate

The first **formal accounting P&L** will use ledger/accrual evidence only. It will not use `FinanceDailyFinancialSummary` or sales summaries as a profit proxy. VAT, employee advances, supplier-due settlement, vault transfers and cash movement are not ordinary P&L amounts merely because cash moves. Any exception needs a separate approved accounting policy and a compatible ledger mapping.

The owner-facing, VAT-inclusive cash-performance view is intentionally a separate report basis. It is governed by [Personal Cash Performance Report Decision](PERSONAL_CASH_PERFORMANCE_REPORT_DECISION_2026-08-20.md); it must not be implemented by mapping VAT or balance-sheet accounts into `FinancePnlMappingVersion`.

P&L stays unavailable until a later gate proves: an approved mapping version; functional-currency/header policy; frozen run/watermark; sealed-ledger cancellation tests; per-line ledger reconciliation; complete source coverage; and authorised server-only outputs. No legal VAT or IFRS compliance claim is made by this policy.

## 8. R0-A verification

`npm run verify:reporting-r0-a-policy` verifies the central mapping validator accepts a complete revenue/expense map and rejects balance-sheet accounts, incomplete active P&L coverage, and duplicate account maps. Schema/migration review additionally requires tenant RLS on policy tables and `FinanceAccountDailyBalance`, immutability after approval, functional-currency format/after-seal protection, and same-version account-to-line linkage.
