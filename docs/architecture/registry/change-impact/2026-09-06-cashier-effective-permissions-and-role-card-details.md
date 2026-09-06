# Change impact — cashier effective permissions and role-card details

- Date: 2026-09-06
- Classification: ARCHITECTURAL
- Owner: Baseer build team

## Decision

Role permissions remain stored as the explicit choices made by an administrator.  At
authorization and session-projection time, the server derives the catalog-defined
effective set in memory.  This repairs roles created before action-to-read
dependencies were introduced without silently writing new grants to their roles.

Operational permissions such as sales closing or purchase entry must not imply
`finance.vaults.read`.  Those workflows may use their authorised server-side
workflow to select or post to a vault, but this does not grant the Treasury/Vaults
screen or its read API.

## Affected boundaries

| Boundary | Change |
| --- | --- |
| Authorization | `CompanyContextService` checks effective grants, including the catalog's sibling read prerequisite. |
| Session/company projection | `CompanyAccessService` returns the same effective grants so navigation agrees with the API. |
| Role management | The catalog exposes Purchases clearly; role cards reveal the effective assigned permissions. |
| Treasury | Vault read stays an explicit treasury permission only. |

## Invariants and acceptance evidence

1. A legacy cashier role with `finance.daily_sales.create` can read the daily-sales workspace through its effective `finance.daily_sales.read` capability.
2. That role does not receive `finance.vaults.read`, does not gain the Vaults navigation, and cannot call treasury read endpoints.
3. Purchase-and-expense permissions are visible in the finance catalog under Purchases.
4. Opening a role's permission details presents its effective permissions, including automatic read prerequisites.
5. Authorization reads do not mutate `RolePermission` records.
