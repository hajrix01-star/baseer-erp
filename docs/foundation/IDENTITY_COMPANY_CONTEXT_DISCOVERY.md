# Identity, Session, and Company Context Discovery

**Status:** Approved foundation discovery — implementation gate

## Noorix behavior observed

- A user belongs to one tenant and may belong to several companies.
- A role supplies permissions; company membership is separately checked from the database.
- Access and refresh JWTs carry a session version; a user disable, password change, or privileged identity change can revoke old tokens.
- Requests acquire tenant context before protected data access; company access is then checked against a live membership query.

## Preserve

- Tenant, company, membership, role, permission, and session are separate concepts.
- The server verifies company membership from authoritative persistence, not only token claims.
- Access and refresh tokens are distinct and session revocation is immediate.

## Harden or correct in Baseer ERP

- JWTs are identity receipts only: `sessionId`, `userId`, `tenantId`, `sessionVersion`, token type, expiry. They do not authorise a company or permission by themselves.
- Every protected request resolves permissions and selected-company membership from the server-side session/principal context, fail closed.
- The selected company is passed only by `X-Baseer-Company-Id`; request bodies, query parameters, and resource IDs never define company scope.
- PostgreSQL row-level security is mandatory for tenant-owned tables. Application checks are a second layer, not a substitute.
- Permission names are explicit capabilities. No implicit super-user bypass exists; platform-owner capabilities are individually declared and audited.
- Session rotation, revocation, audit, rate limiting, password policy, and recovery are mandatory contracts rather than frontend behavior.

## Out of scope for this slice

- User management screens and company administration workflows.
- Finance, HR, operations, reporting, files, and data migration.
- Existing Noorix credential identifiers and password hashes; the migration policy is defined separately.

## Completion proof

1. Login, refresh, logout/revocation, disabled-user, expired-token, and wrong-token-type proofs.
2. Tenant and company cross-scope denial proofs at both policy and database boundaries.
3. Permission denied/default-deny proofs.
4. Audited session lifecycle receipts with no secret or password data.
5. Arabic/English safe error receipts and typed web contracts.

## Central web sign-in and sign-out shell — 2026-08-18

- The web shell renders the sign-in landing before any module launcher, company name, or operational data when no active browser session exists.
- Sign-in sends only `login` and `password` to `/auth/sign-in`; the tenant is resolved by the server. The client then requests `/companies/available` and chooses the only company automatically or asks the user to choose one from the server-authorized list.
- The current-device session stores only the access token and selected company in `sessionStorage`. It does not persist the refresh token, password, permissions, or financial data.
- Central sign-out clears the local session first and requests `/auth/sign-out` with the access token as best effort. A network failure still signs the current device out locally and does not claim server revocation succeeded.
- First-time owner activation remains a separate setup flow; it is not presented as a normal sign-in action.