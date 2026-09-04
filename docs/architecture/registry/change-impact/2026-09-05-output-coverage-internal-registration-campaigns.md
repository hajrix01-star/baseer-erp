# BASEER-IMPACT-2026-09-05-OUTPUT-COVERAGE

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL` (new central output definitions span Operations, Marketing, Output Platform and permission enforcement).
- **Owner modules:** `operations-inventory-commercial`, `marketing-decision-reports`, and `platform-data-contracts`.
- **Scope:** add the next two eligible A4 readings to the existing central output platform: the Operations internal-registration audit report and the Marketing campaign register.  The scope is deliberately limited to these server-owned, bounded reads; it does not print the browser shell, a data-entry form, a dashboard card, provider settings, or an inferred financial result.

## G0 — Contract and ERP control

The owner asks that unfinished section printing be completed professionally.  The qualifying journeys are: (1) a manager opens **طلبات → التقارير → تقرير التسجيل الداخلي**, selects a business period, and requests an independent A4 report; (2) an authorized user opens **التسويق → الحملات**, requests an independent campaign-register A4 report, optionally limited to one stored lifecycle status.  Both output requests create a server snapshot with company identity, generated-at time, locale/direction, filters and audited idempotency receipt.

Acceptance: each matching reading exposes one central A4 action; the snapshot has no React-provided rows/totals; a tenant/company/permission boundary is re-authorized by the output service; invalid filters and unbounded history are rejected; Arabic RTL and English LTR remain printable with normalized western dates and numbers.

## G1 — Capacity and continuity

Internal-registration output accepts an explicit `from/to` period of no more than 366 calendar days, and its server read rejects more than 1,000 registrations instead of truncating the report.  Campaign-register output accepts only an optional status from the existing finite lifecycle enum and its server read rejects more than 1,000 campaigns instead of silently rendering a prefix.  Neither creates a job, schema change, cache, migration, document, posting, inventory movement, financial transaction, provider request or client aggregation.  Output rendering remains subject to the platform's inline artifact ceiling and is reversible by one code change.

## G2 — Data, contracts and accounting boundary

`OperationsInternalRegistrationService.report` remains the authoritative read: it returns stored registration numbers, dates, section and line snapshots.  The output is managerial/audit information only; it does not recalculate inventory cost or alter internal registrations.  `MarketingService.workspace` remains the authoritative campaign register and contains campaign context, lifecycle and planned (not posted) cost.  The output labels planned cost as planned and does not claim spend, revenue, conversion or causality.  Permissions are additive to the generic output permission: `operations.internal_registration.read` for the registration report and `marketing.insights.read` for the campaign register.

## G3 — Direct technical path

No package, UI library, schema or endpoint is added.  `OutputService` receives the existing operations registration service, dispatches two explicit report codes, validates a narrow filter allow-list, calls the server read service again inside the trusted company context, and delegates PDF/XLSX presentation to the existing output platform.  The corresponding React surfaces reuse `BaseerOutputActions`.  A generic `window.print()` or a page-snapshot endpoint is rejected because it could expose unrelated controls, bypass server filtering, and turn browser-calculated display state into an export record.

## G4 — Experience system

Use `BaseerOutputActions`, `BaseerShareMenu`, `BaseerPeriodFilter`, existing heading action slots, and the existing A4 template.  The action is visible only on its matching read surface, supports loading/disabled states via the central component, and keeps Arabic/English plus RTL/LTR.  No new visual component, decorative motion, or global print CSS is introduced.

## G5 — implementation and focused verification

`OutputService` now regenerates `operations.internal-registration-report` from the bounded `OperationsInternalRegistrationService.reportForOutput` read using only an explicit `from/to` period and `operations.internal_registration.read`.  The period is capped at 366 days and more than 1,000 registrations is rejected before rendering.  `marketing.campaign-register` regenerates the bounded `MarketingService.campaignRegisterForOutput` read using only an optional lifecycle status and `marketing.insights.read`; more than 1,000 campaigns is rejected before rendering.  Both use the central company logo, A4 renderer, output audit events and idempotency handling.  The Operations report tab and campaign register use `BaseerOutputActions`; the campaign action forwards the visible lifecycle filter.

Evidence on 2026-09-05:

- `npm run check --workspace @baseer-erp/contracts` — passed.
- `npm run check --workspace @baseer-erp/api` — passed.
- `npm run check --workspace @baseer-erp/web` — passed.
- `npm run build --workspace @baseer-erp/output-platform` — passed.
- `npm run test:e2e --workspace @baseer-erp/web -- operations-mocked-auth.spec.ts modern-theme-insights-dialogs.spec.ts --workers=4 --reporter=dot` — 32 passed across desktop and mobile.
- `npm run check:architecture`, `npm run check:dead-code`, `npm run check:web-financial-boundaries`, and `npm run check:web-localization` — passed.

## Delivery boundary

The qualified-print catalogue is complete for this request: official Finance reports retain their existing immutable document actions; Operations report tabs have received-material/custody and internal-registration outputs; Marketing has performance-calendar and campaign-register outputs.  Data-entry forms, catalog maintenance, dashboard cards, external-provider readiness, and policy/settings panels intentionally have no page-print action: they are not report records and printing them would violate the no-browser-shell/no-client-snapshot contract.  Production publication remains constrained by the already approved isolated-VPS runbook; no Noorix resource is touched.
