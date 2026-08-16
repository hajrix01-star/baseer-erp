# BASEER ERP â€” Financial and Factual Source-of-Truth Policy

**Status:** Owner-approved, mandatory across every present and future module.
**Scope:** Finance, Operations, Marketing, Reports, Command Center, AI, Inbound Evidence, integrations, imports, exports, and native UI.

## 1. The rule

Baseer has one accounting truth:

> Every money amount shown as sales, revenue, expense, tax, receivable, payable, loan balance, vault balance, profit, cash movement, payment, or accounting spend must be read from a server-owned projection reconciled to the active, sealed accounting journal.

A browser, an editable dashboard table, a provider metric, a manual campaign field, a payment-order request, an attachment, or an operational form is never an independent financial source of truth.

## 2. The required path for money

```text
Authorized business command
  -> validated financial document / workflow
  -> balanced sealed journal (or documented reversal)
  -> server read model with reconciliation metadata
  -> report, Marketing analysis, Command Center, AI read tool, export, or UI
```

The journal is not exposed for manual posting. A module may not calculate a different financial balance, duplicate monetary totals, or query another module's private financial tables.

## 3. Operational and external facts

Not every useful number is monetary. Operational and external facts retain their own immutable, company-scoped source, timestamp, freshness and quality:

| Fact                                                             | Authoritative source                              | Financial meaning                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sales close scope, customer count, channel detail, operating day | Daily Sales Closing and Operational Calendar      | Supports detail; posted sales money must reconcile to the journal. A documented Day Off controls the average denominator only; it never creates money. Explicit cash handover is a separately labelled management record and is never a journal balance, revenue, or sales-channel total. |
| Google Ads cost/clicks/conversions                               | Immutable provider snapshot and sync receipt      | Provider fact, never an ERP sale or accounting spend by itself                                                                                       |
| Google Business searches/views/calls/directions/reviews          | Immutable provider snapshot and sync receipt      | Engagement fact, never customer/revenue proof                                                                                                        |
| Cash-on-hand observation                                         | Approved cash-count/observation record            | Management observation only; not a vault balance or journal movement                                                                                 |
| Email, Telegram, SMS, or attachment evidence                     | File/evidence metadata and receipt                | Evidence only until a human-approved financial command posts a journal                                                                               |
| AI explanation                                                   | Read-only tool receipt referencing approved facts | Never an independent fact, financial command, or authority                                                                                           |

A combined report may use these facts, but it must identify each source, date/timezone, freshness, quality, and reconciliation state. Missing or partial data is `unknown`/`incomplete`, never zero.

## 4. Reports, Marketing, Command Center, and AI

- Financial reports, profit/loss, tax, vault movement, balances, cash projections and spend use journal-reconciled server read models.
- Marketing can compare campaign/provider facts with confirmed sales only through the shared server read model. It never reads a browser total, writes a journal, or presents association as causation.
- Command Center contains a small read-only executive summary from the same read models; it does not recalculate or duplicate dashboards.
- AI receives narrow, authorized, redacted read-model facts with citations and freshness. It cannot infer an unrecorded amount as accounting truth.

## 5. Enforcement for every module

Every Module Discovery Record, ADR, API contract, report/read-model design, import plan, integration decision and AI tool must state:

1. the money source and the factual source separately;
2. the journal posting/reversal that makes a financial amount authoritative;
3. the reconciliation rule and receipt;
4. tenant/company scope, permissions, date/timezone, freshness and quality;
5. why no browser, provider, attachment or AI output can become a duplicate financial truth.

Any proposed module that cannot satisfy this policy is blocked before schema, UI or connector work begins.

## 6. Exceptions

There is no implicit exception. A statutory report, future external reconciliation, or owner-approved accounting-policy exception requires a dated decision record that states scope, basis, data sources, reconciliation and owner approval. It may not weaken journal immutability, company isolation, audit, the no-browser-calculation rule, or the rule that a financial posting cannot use a future Riyadh business date.
