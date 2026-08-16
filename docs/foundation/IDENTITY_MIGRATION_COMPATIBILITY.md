# Identity migration compatibility

## Decision

Baseer ERP remains the independent identity authority. Noorix is a read-only
discovery and future migration source; there is no runtime authentication link,
dual write, session transfer, or token transfer between the systems.

## Preserve

- Normalize identifiers as Noorix does: trimmed and lowercase. BASEER also accepts a short username at the sign-in and user-creation boundary; the server deterministically resolves it to `<username>@<tenant-code>.baseer.local`. The stored identity remains email-shaped and unique per tenant, while the administration screen displays the short form.
- Accept and verify migrated bcrypt password hashes. New Baseer password hashes
  use bcrypt cost 12.
- Verify the selected company and permissions from Baseer's live database
  records, never from a token claim.

## Correct and harden

- Noorix CUID identifiers are mapped to new Baseer UUIDs. A future migration
  creates explicit legacy-to-Baseer mappings for tenant, user, company, role,
  membership, and audit references.
- Existing Noorix JWTs and sessions are not migrated. Users establish new
  Baseer sessions after cutover.
- Baseer tokens contain only identity receipt claims: session, user, tenant,
  session version, explicit token type, and expiry. They contain no roles,
  permissions, or company list.
- Each refresh checks the live user and `AppSession`; sessions are independently
  revocable and refresh tokens are stored only as hashes.
- A legacy user may have a password shorter than the new password policy.
  Sign-in therefore accepts an existing non-empty password; stronger rules
  apply only to new passwords and resets.
- Legacy owner or super-admin bypasses are never copied implicitly. Their
  imported capabilities require an explicit owner-approved mapping.

## Deferred to the dedicated migration slice

- Snapshot extraction and identifier mapping.
- Hash-format preflight and forced-reset handling for unsupported hashes.
- Import, reconciliation, dry run, cutover, and owner approval.

## Evidence

Read-only review of Noorix `auth.service.ts`, `jwt.strategy.ts`, company and
roles guards, tenant context, and Prisma schema on 2026-08-14.
