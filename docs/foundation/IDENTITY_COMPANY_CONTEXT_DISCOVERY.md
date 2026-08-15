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
