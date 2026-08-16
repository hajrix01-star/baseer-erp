# Global sign-in and general-owner activation

All BASEER ERP users sign in with an email address or a globally unique short username and a password. A tenant code is never requested by the browser. The server resolves the identity, validates the live session, and then exposes only the companies permitted by that user’s live memberships.

A tenant general owner is the explicit exception: after successful sign-in, the owner may select every active company in the private system tenant. Each company command remains authorized server-side and the owner path is audited.

## First activation only

The first deployment creates the owner with `scripts/bootstrap-general-owner.mjs`. The script accepts a **one-time activation code** through the deployment environment, stores only its bcrypt hash, and expires it after seven days. The owner chooses a password on the “Activate general owner” screen. Successful activation clears the one-time hash atomically. Re-running the bootstrap script never overwrites an active owner or their password.

The production database is persistent. Deployment uses the same database and `prisma migrate deploy`; it must not run a seed that recreates users. Therefore the chosen password remains unchanged after releases.

The deployment environment sets `BASEER_SYSTEM_TENANT_CODE` once. This private code is server-only configuration used to resolve logins; it is never shown or entered in the browser.

## Rules

- The owner email is normalized case-insensitively: `mohammad.alhajri@gmail.com`.
- A username must be globally unique in a private BASEER deployment; an email is recommended. The server rejects an ambiguous legacy login rather than guessing a tenant.
- A user with one permitted company enters it directly. A user with more than one chooses from the company control in the top bar.
- Tenant codes remain internal migration/administration data, not a login credential.
- Do not keep activation codes in Git, client-side storage, screenshots, or the production `.env` after activation.
