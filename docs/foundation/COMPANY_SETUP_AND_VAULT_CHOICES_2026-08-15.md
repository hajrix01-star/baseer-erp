# Company Setup and Vault Choices — Decision and Source Delivery

**Status:** Implemented in source in the Finance Setup workspace on 2026-08-17; activation awaits the controlled category-hierarchy database migration.
**Scope:** BASEER ERP private companies only.

## Approved company-start choices

The company setup flow presents these ready vault options and creates only the choices selected by the owner:

| Choice | Type | Sales channel | Payment source by default |
| --- | --- | --- | --- |
| نقد | Cash | Yes | Yes |
| بنك | Bank | No | Yes |
| هنقرستيشن | App | Yes | No |
| جاهز | App | Yes | No |
| كيتا | App | Yes | No |

The platforms are separate application collection/sales channels. They are not mixed with cash or bank balances and are not default sources for supplier or loan payments.

## Lifecycle

- A company may add a custom vault after setup; Baseer gives it a company-local asset account.
- If a vault has no financial history, it can be deleted. Its custom backing account is archived rather than reused.
- If it has supplier-due or loan-payment history, it is archived: hidden from new selections while its history remains available.

## Delivered source components

- Base account seeds for HungerStation, Jahez, and Keeta settlement vaults.
- `CompanyFinanceSetupService`, which initializes the finance foundation, creates one non-overlapping fiscal period, and creates selected ready vaults transactionally and idempotently.
- `VaultManagementService`, which creates custom vaults and deletes or archives them according to financial history.

## Verification

- API TypeScript check and build passed.
- No database migration or live data was applied as part of this server-only increment.
