# BASEER-IMPACT-2026-09-03-DAILY-SALES-HTTP-CONTRACT-FIXTURE

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Scope:** the CI-only assertion in `scripts/run-daily-sales-http-verification.mjs` for the server-owned daily-sales analytics read.
- **Observed evidence:** GitHub Actions run `33748598361` reached the daily-sales HTTP verification and rejected two fields that the typed contract and the backend already expose: `otherOfficialSalesGrossAmount` and `otherOfficialSalesGrossPlotValue`.
- **Decision:** preserve the strict response assertion and extend its expected value with both existing server-calculated fields.  Do not change the API, database schema, financial calculation, permission, client calculation, or deployment configuration.

## Gates and financial controls

- **G0:** acceptance is a green HTTP verification that still proves all visible analytics values are formatted and calculated by the server.
- **G1:** no query, volume, concurrency, or retention change; this is a test-fixture alignment only.
- **G2:** financial truth remains `DailySalesReadService` and the typed `dailySalesAnalyticsDisplaySchema`.  The added display string and plotting coordinate are already calculated server-side from posted closings.
- **G3–G4:** no dependency, platform, UI component, or visual behavior change.
- **G5–G7:** run the exact daily-sales HTTP verification, contract/API checks, architecture guard, and then CI.  Any mismatch must fail rather than weaken the assertion.

## Rollback

Revert the single fixture assertion and its governance record.  No production state, financial record, migration, DNS, or Hostinger resource is affected.
