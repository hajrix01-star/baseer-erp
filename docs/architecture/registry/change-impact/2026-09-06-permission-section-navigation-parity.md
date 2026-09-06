# Change impact — permission section/navigation parity

- Date: 2026-09-06
- Classification: ARCHITECTURAL
- Registry: `BASEER-ARCH v1.0`

## Problem and decision

The server capability `finance.purchase_expense.*` powers the visible
`operations-purchases` workspace, but its permission-picker presentation used
the capability namespace and placed it under Finance. This made users find
purchase requests while the real Purchases permission appeared elsewhere.

The capability code and server authorization remain unchanged. The permission
presentation becomes an explicit, ordered projection of the actual navigation
surface: Purchases appears in Operations immediately after Sales. Presentation
metadata, not a financial permission name, owns this placement.

## Boundaries

| Boundary | Decision |
| --- | --- |
| Stored role grants and API authorization | Unchanged: `finance.purchase_expense.*` remains the authority. |
| Administration overview contract | Adds display ordering so client and server share one deterministic sequence. |
| Role picker | Sorts modules and sections by the server-provided navigation order. |
| Operations navigation | Source evidence: `page-registry.ts`, `operations-purchases` at order 30, following Sales at order 20. |

## Acceptance

1. A role editor displays «العمليات» then «المبيعات» followed by «المشتريات».
2. Purchase permissions appear in «المشتريات», not in «المالية والخزائن».
3. Purchase requests remain separately named and do not replace Purchases.
4. Capability keys, role storage, and authorization behaviour do not change.
