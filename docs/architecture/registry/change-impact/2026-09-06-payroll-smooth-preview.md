# Smooth payroll preview updates

- BASEER-ARCH v1.0; CONTROLLED presentation and request scheduling change. Base78673b512e0e8b0172d00b01a6635268a48602bb, branch codex/payroll-smooth-preview. Reuse payroll-selection-summary and its financial/approval contracts.
- User reports flicker and delay after the preceding payroll release. Parent owns dialog/CSS/browser tests/docs; existing independent reviewer approved G0–G4 before code. Existing explicit merge/deploy authorization applies to this continuing refinement.
- G0/G2: server remains the sole source of money calculations. Separate display of the last successful same-context receipt from strict previewCurrent permission to save/review. Show pending state immediately on input-key mismatch, retain values while pending, and clear values on errors or month/draft/company context changes. No local optimistic arithmetic or posting change.
- G1/G3: immediate queued request for discrete selection and navigation;150ms debounce only for amount typing. Retain abort/sequence matching, cancel queued timer on manual refresh/context change. Same endpoint/page size/server work; no new dependency, query cache or backend/schema change. No claim of eliminating network round-trip time.
- G4: reuse BaseerSummaryMetric, BaseerMoney and dialog. Fixed-space pending status with aria-busy, stable table/card/footer values during updates. No number animation, fading, skeleton pulses or layout movement. AR/EN and desktop/mobile.

| Before | After | Why |
|---|---|---|
| All numbers become dashes while refreshing | Last confirmed values remain visibly pending | Prevent flicker without approving stale amounts |
|250ms wait for every interaction | Immediate selection requests;150ms for typing | Remove avoidable click latency while coalescing typing |
| Loading paragraph appears/disappears | Reserved status space | Keep cards/table from jumping |

- Acceptance: held responses keep prior money and geometry while saving is disabled; response replaces values; error clears stale receipt; corrected input recovers; late responses cannot replace latest; discrete action not delayed by typing debounce; month/draft context reset; full payroll AR/EN desktop/mobile browser suite, web check/build and financial/transport/localization guards. Reuse existing backend/DB evidence because source unchanged. Independent delivery GO, normal CI and immutable deployment verification before completion.

## Verification and independent review
- Ten focused browser cases passed for pending retention, frozen-clock scheduling, over-salary rejection/recovery and stale response protection. Parent inspected Arabic desktop/mobile pending screenshots; geometry checks cover card/footer/table-heading positions and dimensions.
- Updated the old transient disabled-button assertion: immediate server responses can complete before the assertion executes. The held-response cases explicitly prove saving remains disabled for the full request duration.
- Final40-case payroll run:39 passed; one unrelated employee-profile case timed out while creating the browser page before its test body. Its isolated rerun passed1/1 with no code change. All40 cases passed across that run and retry, including the new-month test that clears previous cards/footer/rows until the new receipt arrives.
- Closed review timing finding by resetting the delay explicitly for selection/all/clear/month/navigation/manual refresh, including after no-op amount normalization. Existing abort/sequence checks and strict submission/approval freshness remain unchanged. Independent source review found no remaining blockers; final web build and release pipeline results are recorded at delivery.
- Web typecheck, initial production build, architecture, financial-boundary, central transport, localization and numeric-policy checks passed. A final production rebuild covers the timing-only review correction. No backend/DB retest was needed because those sources are unchanged.
- Final production rebuild passed (TypeScript and Vite,1612 modules). Independent review conditions are satisfied for local GO; normal PR CI and immutable production release verification remain required.
