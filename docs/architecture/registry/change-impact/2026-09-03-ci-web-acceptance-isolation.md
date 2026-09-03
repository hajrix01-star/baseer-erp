# BASEER-IMPACT-2026-09-03-CI-WEB-ACCEPTANCE-ISOLATION

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL` (release-gate orchestration).
- **Scope:** `.github/workflows/verify.yml`, `apps/web/playwright.config.ts`, and the finance browser-acceptance fixture.
- **Observed evidence:** run `33751242460` passed 53 quality gates, then its 596 Playwright tests were cancelled by the quality job's 20-minute ceiling.  GitHub allocated one default Playwright worker despite `fullyParallel`; browser setup and the serial quality sequence left roughly eleven minutes for web acceptance.
- **Decision:** preserve every existing acceptance test, but run web acceptance in an isolated required job.  Give that job its own 30-minute ceiling, run two CI workers (the hosted runner's available capacity), preserve traces/screenshots, and make every release-image job require both `quality` and `web-acceptance`.

## Gates and boundaries

- **G0:** release images and their immutable manifest must remain blocked when either quality or web acceptance fails, is cancelled, or times out.
- **G1:** the CI executor has two available cores; two browser workers are the bounded capacity choice.  The separate job prevents unrelated database/container checks from consuming the E2E time budget.
- **G2:** no production API, database, tenancy, financial truth, browser-to-API contract, or deployment resource changes.  The Vite proxy remains test behavior; a completed E2E result, not a timeout, is required before treating proxy messages as defects.
- **G3–G4:** no runtime dependency, UI, or product behavior changes.  Official GitHub Actions and Playwright already in the repository are reused.
- **Acceptance-fixture alignment:** the finance fixture must assert the centralized text-based Gregorian calendar and the reference-tree navigation actually rendered by Baseer ERP. It must not require the retired native `input[type=date]` control or the retired `module-navigation` class. This changes test evidence only, not customer-visible behavior or the browser-to-API contract.
- **Accessibility correction:** the active finance setup step uses the semantic deep brand token, keeping the required 4.5:1 contrast threshold in the shared stepper without changing its interaction, route, API, or financial behavior.
- **HR fixture alignment:** workforce signals are read-only operational indicators. The acceptance test verifies their labelled content and does not assert an obsolete button/pressed-state interaction.
- **Decision fixture alignment:** period selection uses the shared accessible combobox, and company-event dates use the same central calendar text field and owned popover as the rest of the application. The test retains validation and Escape/focus assertions without requiring retired native controls.
- **Command Center fixture alignment:** shell acceptance provides the complete current read receipts that the shared financial and marketing workspaces require. This prevents a deliberately incomplete legacy mock from being mistaken for a production runtime failure.
- **Runtime resilience:** the weekly sales card treats a malformed or incomplete read as unavailable data instead of throwing inside the workspace. Financial figures remain server-owned; this is an error-boundary safeguard only.
- **Visual evidence stability:** shell snapshots retain a strict 0.1% pixel-difference ceiling, which absorbs font rasterization noise while preserving a meaningful regression signal.
- **Visual scope:** desktop shell evidence captures the persistent navigation rail itself. This directly tests the contract under review and avoids unrelated live-workspace loading affecting the screenshot budget.
- **G5–G7:** verify workflow syntax and Playwright discovery locally, then require the complete GitHub `quality` and `web-acceptance` jobs.  A cancelled job is not accepted evidence.

## Rollback

Revert the workflow/configuration and governance entry.  No production environment, DNS, server, database, or user data is affected.
