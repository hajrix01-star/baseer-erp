# Module delivery rulebook

No module begins implementation before its discovery record defines:

1. business goal and users;
2. legacy workflows, exceptions, permissions, and serial rules;
3. authoritative data sources and backend calculations;
4. create, list, detail, edit, cancellation, recovery, print/export needs;
5. accounting, tax, inventory, HR, or audit effects;
6. migration and parity acceptance cases.

## Definition of done

A module is complete only when its core user journeys work entirely in Baseer ERP with no legacy route, hidden redirect, iframe, local financial arithmetic, or broad legacy API projection.

Every write requires company scope, exact permission, server validation, atomic transaction, audit, idempotency when retryable, and a safe error/recovery path.

Every financial/operational date is a server-owned `businessDate` (`DATE`) distinct from issuance and audit timestamps. The UI sends only date intent or a strict date selected by the user.

The next module cannot start until tests, reconciliation, RTL/mobile/accessibility, and owner acceptance for the current module are complete.
