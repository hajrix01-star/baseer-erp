# BASEER-IMPACT-2026-09-03-CI-WEB-ACCEPTANCE-ISOLATION

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL` (release-gate orchestration).
- **Scope:** `.github/workflows/verify.yml`, `apps/web/playwright.config.ts`, browser-acceptance fixtures, deployable runtime dependency lock resolution, root-level API verification launchers, and the local CI-parity runner.
- **Observed evidence:** run `33751242460` passed 53 quality gates, then its 596 Playwright tests were cancelled by the quality job's 20-minute ceiling.  GitHub allocated one default Playwright worker despite `fullyParallel`; browser setup and the serial quality sequence left roughly eleven minutes for web acceptance.
- **Decision:** preserve every existing acceptance test, but run web acceptance in an isolated required job.  Give that job its own 30-minute ceiling, run two CI workers (the hosted runner's available capacity), preserve traces/screenshots, and make every release-image job require both `quality` and `web-acceptance`.
- **Clean-checkout correction:** browser acceptance must build `@baseer-erp/contracts` before Vite starts.  The package exports `dist/*`; local workspaces can conceal a missing build through pre-existing artifacts, while a clean GitHub checkout correctly exposes it.
- **Security correction:** retain the blocking runtime audit and update the lockfile only to patched, compatible Fastify/URI releases. Nest 11's Fastify adapter is retained because its 12.0.0 package is not ESM-compatible with the existing Nest 11 runtime despite its peer declaration. A scoped package override lifts only its embedded Fastify dependency to 5.12.1; the gate is not reduced and no Nest framework package is upgraded.
- **Verification resolution correction:** every root-level API verification/maintenance launcher resolves the API-owned Fastify adapter through one `apps/api/package.json` resolver, not through an accidental root hoist. This keeps CI and clean local installs on the same module-resolution contract.
- **Local parity gate:** `scripts/run-ci-parity.ps1` runs the exact `quality` and `web-acceptance` workflow jobs through Ubuntu WSL's Linux Docker socket and `act`, from a disposable LF Git clone of the committed candidate.  Windows `act` is intentionally not used: its Docker named-pipe bridge cannot provide the inner socket required by the image-verification gate. It is mandatory for release candidates and infrastructure/dependency/test-runner changes; targeted checks remain the fast feedback path for isolated product changes.

## Gates and boundaries

- **G0:** release images and their immutable manifest must remain blocked when either quality or web acceptance fails, is cancelled, or times out.
- **G1:** the CI executor has two available cores; two browser workers are the bounded capacity choice.  The separate job prevents unrelated database/container checks from consuming the E2E time budget.
- **G2:** no production API, database, tenancy, financial truth, browser-to-API contract, or deployment resource changes.  The Vite proxy remains test behavior; a completed E2E result, not a timeout, is required before treating proxy messages as defects.
- **G3–G4:** no UI or product behavior changes. Official GitHub Actions and Playwright already in the repository are reused. Runtime dependency changes are restricted to patched compatible releases and require type/build/audit verification.
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
