# BASEER-IMPACT-2026-09-03-CI-ATTENDANCE-PEPPER-LENGTH

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Scope:** CI-only environment fixture in `.github/workflows/verify.yml` consumed by `run-attendance-http-verification.mjs`.
- **Observed evidence:** GitHub Actions run `33750094078` passed the daily-sales gate and then failed attendance recording because its fixture value for `ATTENDANCE_PIN_PEPPER` was shorter than the deployment configuration's mandatory 32-character minimum.
- **Decision:** change only the non-production CI fixture to a fixed value of at least 32 characters.  Preserve the production validation rule; do not lower it or alter attendance behavior, storage, database schema, permissions, rate limiting, or retention.

## Gates

- **G0:** acceptance is that the attendance HTTP verification starts with a valid configuration and still proves its authorization, retention, and throttling boundaries.
- **G1–G2:** no runtime capacity, query, contract, financial, tenant, or data-source change.
- **G3–G4:** no dependency, UI, or deployment change; fixture remains CI-only.
- **G5–G7:** run the exact attendance HTTP verification, the architecture guard, and GitHub CI.  A short secret must continue to be rejected by the production configuration validator.

## Rollback

Revert the CI fixture value and its governance record.  No live secret, server, DNS, or application data is touched.
