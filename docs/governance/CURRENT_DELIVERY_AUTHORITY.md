# BASEER ERP — Current Delivery Authority

**Last updated:** 2026-08-17
**Purpose:** one authoritative entry point for current delivery status, evaluation outcomes and build order.

## Canonical documents

1. [Current 360 review and stabilization status](COMMITTEE_360_REVIEW_AND_BUILD_CONFIRMATION_2026-08-16.md) — current quality decision, open production boundaries and evidence.
2. [Committee build sequence](../foundation/BASEER_BUILD_SEQUENCE_COMMITTEE_PLAN_2026-08-15.md) — the only active execution order.
3. [Module delivery register](MODULE_DELIVERY_REGISTER.md) — the current state of every scope.
4. [Hostinger private hosting and backup decision](../operations/HOSTINGER_PRIVATE_HOSTING_AND_BACKUP_DECISION_2026-08-16.md) — the current hosting, backup and restore policy.
5. [Quality evidence and committee register](QUALITY_EVIDENCE_AND_COMMITTEE_REGISTER.md) — the single ledger of recorded checks, committee outcomes and open quality gates.
6. [Acceptance and Quality Committee Charter](ACCEPTANCE_AND_QUALITY_COMMITTEE_CHARTER.md) — the permanent BAQC composition, remit and independent acceptance method.

When status or priority changes, the current 360 review, build sequence and module register are updated in the same change. If they disagree, this file directs the reader to the 360 review first, then the build sequence, then the register; the discrepancy must be corrected before a new scope starts.

## Current decision

S1 stabilization is closed for local development, but the 2026-08-17 BAQC retrospective review has opened a bounded **stabilization-and-verification remediation** scope. Purchase & Expense, including Expenses & Obligations, remains in owner verification; **Treasury and vault movements** remains the only active verification scope. No new business scope starts until the review's P1 closure evidence is recorded.

The owner authorized a bounded **Suppliers native-workspace implementation** exception while away from the office: supplier master data may be added, edited and archived in Operations, but it does not close Treasury, activate invoices, or change the accepted sequence.

The owner also authorized a bounded **Categories management** exception: Finance section 4 provides a native, server-governed category tree with search, filters, add/edit, and safeguarded archive. It is master-data maintenance only, remains subject to owner acceptance, and does not change Treasury or Purchase & Expense closure.

The owner also authorized a bounded **Invoice Register read-model** exception: Finance section 1 may present all server-owned posted financial journal movements except internal vault transfers, with central filters and dynamic ledger-derived cards. It is a read-only surface, does not activate a new invoice-entry scope, and does not close Treasury or Purchase & Expense acceptance.

Purchase & Expense, including Expenses & Obligations, is in owner verification: its recurring-expense and cash-on-payment supplier-due migrations are applied on the isolated local test database and the dedicated DB/HTTP verifiers pass. The cash-on-payment policy is authoritative for newly recorded supplier credit documents: unpaid credit stays outside P&L and the expense is recognized on settlement; see `../foundation/CASH_ON_PAYMENT_EXPENSE_POLICY_2026-08-17.md`. Native Arabic/English acceptance, financial correction/cancellation scope, and production-release gates remain open. The owner explicitly authorized **Treasury and vault movements** as the sole active build scope: ledger-derived vault balances, add/archive lifecycle, balanced internal transfers, and bounded history. Cash count/handover reporting, bank reconciliation and transfer reversal remain separately scoped. A private/production release remains blocked until Hostinger backup coverage and an isolated restore rehearsal are evidenced. Assets & Warranty is recorded as a planned Gate A after reconciled finance read models; its purchase follow-up marker is operational only and does not activate a new scope or an accounting effect.

## Architecture authority

- [Master build charter](../BASEER_ERP_MASTER_BUILD_CHARTER.md) governs non-negotiable product and engineering principles, not day-to-day sequence.
- [User-facing modules V3](../architecture/BASEER_ERP_USER_MODULES_V3.md) governs navigation.
- [Module Taxonomy V2](../architecture/BASEER_ERP_MODULE_TAXONOMY_V2.md) governs internal boundaries.
- [Noorix maps](../architecture/NOORIX_TO_BASEER_ERP_MODULE_MAP.md) are read-only comparison and migration evidence; they do not define the Baseer target architecture.

## Standards authority

- [Baseer UI system standard](BASEER_UI_SYSTEM_STANDARD.md) is the sole authority for shared web components, typography, dialogs, cards, tables, controls and RTL/LTR interaction rules.
- [Design system and component standard](DESIGN_SYSTEM_AND_COMPONENT_STANDARD.md) records the component architecture that implements the UI standard; it must not introduce a competing visual language.
- [Web design system and filter standard](../foundation/WEB_DESIGN_SYSTEM_AND_FILTER_STANDARD_2026-08-16.md) is the implementation record for the current filter and application-shell work. It extends the UI standard and does not override it.
- [Display numbers and currency standard](DISPLAY_NUMBERS_AND_CURRENCY_STANDARD.md) is the authority for formatting numbers, currency and percentages across every module.
- [Technical contracts and quality standard](TECHNICAL_CONTRACTS_AND_QUALITY_STANDARD.md) and [module delivery rulebook](MODULE_DELIVERY_RULEBOOK.md) govern quality gates and delivery evidence; they do not set module priority.

## Historical documents

Earlier reviews, Gate A/B delivery records and individual module decisions remain immutable evidence of what was tested or decided at their date. They are not alternative current roadmaps.

- The Daily-Sales-before-Marketing priority amendment is historical and superseded for post–Daily Sales sequencing by the AI-and-Finance amendment.
- Quality and stabilization records are historical evidence consolidated by the current 360 review.
- Provider, marketing and inbound decisions retain their own scope boundaries, but activation order always comes from the canonical build sequence above.

**سجل الاستثناء:** [Scope exception log](SCOPE_EXCEPTION_LOG.md) يوثق بدء Treasury أثناء بقاء Purchase & Expense في قبول المالك.
