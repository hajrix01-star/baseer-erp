# BASEER ERP private online deployment and recovery rehearsal

## Boundaries

This package is for the owner's private BASEER ERP and the owner's companies. It is not a SaaS service and it must not offer public account registration. The application name remains **BASEER ERP**. The public domain is a deployment setting and can change without renaming the application.

Only the reverse proxy exposes HTTPS. PostgreSQL has no host port and remains on an internal Docker network. Docker administration, database access, backups, and source access remain private to the owner or explicitly authorised operators.

## Files supplied

- `Dockerfile`: separate `runtime` API image and short-lived `migrate` image.
- `docker-compose.private-online.yml`: private API, internal PostgreSQL, and HTTPS reverse proxy. It consumes immutable OCI digests only; it never builds the repository checkout.
- `docker/Caddyfile.private-online`: HTTPS reverse proxy configuration; certificates are handled by Caddy after DNS points to the selected domain.
- `ops/private-online/.env.private-online.example`: non-secret configuration template.
- `docs/operations/PRIVATE_ONLINE_FILE_STORAGE_AND_RECOVERY.md`: same-server
  bind-mount, file-encryption, scanner, backup, and isolated-restore procedure.
- `docker/baseer-private-init/10-create-baseer-app.sh`: creates a non-superuser database application role on the first empty database volume.

## Before the first private deployment

1. Choose the owner-controlled Hostinger server and subscribe to Hostinger daily server backups. Do not treat the live database volume itself as a backup. The adopted policy is recorded in `HOSTINGER_PRIVATE_HOSTING_AND_BACKUP_DECISION_2026-08-16.md`.
2. Choose any available domain and point its DNS records to the private server. The domain may change later; **BASEER ERP** remains the product name.
3. Copy `ops/private-online/.env.private-online.example` to `ops/private-online/.env.private-online`; replace every placeholder with unique secrets stored outside the repository. Prepare the permanent same-server file-storage bind mount before startup as described in `PRIVATE_ONLINE_FILE_STORAGE_AND_RECOVERY.md`. Create `backup-archives/` beneath it with write access for uid 1000; it is private encrypted archive storage and must never be reverse-proxy served. Keep archive worker and scheduler switches `false` until their isolated recovery rehearsal is accepted.
4. From the successful `main` CI run for the approved commit, download the
   `baseer-release-manifest-<commit>` artifact. Copy its exact API, migrate,
   and web `image@sha256:...` values into `ops/private-online/.env.private-online`.
   Pin the approved PostgreSQL and Caddy vendor digests in that file too. Do
   not substitute a tag such as `latest`, `main`, or a commit tag, and do not
   build images on the production host. The CI images include OCI SBOM and
   provenance attestations; retain the manifest artifact alongside the release
   and Gate C evidence.

5. Validate the release input before Compose. This preflight reads the real
   private environment file and the downloaded manifest, rejects every image
   tag, and requires API, migrate, and web to exactly match the approved
   manifest values. It does not contact a registry or start services:

   ```powershell
   node scripts/verify-private-online-release-preflight.mjs --env-file ops/private-online/.env.private-online --manifest C:\path\to\baseer-release-manifest.json
   ```

6. Validate the resolved production configuration without contacting a
   registry or starting services:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml config -q
   ```

7. Start the release stack through the dedicated post-migration reconciler.
   Compose waits for `migrate` to succeed, then reapplies only the restricted
   runtime grants to `BASEER_DB_APP_USER`, including the explicit
   `AuditEvent` append-only revocation that cannot be completed before the
   first migration creates that table:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml up -d
   ```

   The API must run only with `BASEER_DB_APP_USER`, never `postgres`. The
   `migrate` job has the bootstrap database credential, no public listener,
   and exits after `prisma migrate deploy`; it must not be kept running. The
   `grant-app-access` job is also internal and one-shot; a non-zero exit from
   either job blocks API startup through the Compose dependency graph. The PowerShell grant script remains the
   supported explicit reconciliation command for an already-migrated existing
   database.

   The public `api` image intentionally excludes the Prisma CLI,
   `@prisma/config`, and `deepmerge-ts`. This boundary is checked while the
   image builds, so a future dependency change cannot silently put migration
   tooling back into the API container.

8. The release order is technically enforced: backup/restore gate → successful
   `migrate` job → successful restricted-role reconciler → API rollout. A
   failed migration or reconciliation stops API startup. The migration job is
   read-only except for its temporary filesystem,
   has no public port, uses `no-new-privileges`, and has access only to the
   database network.

9. Create users only through the approved administrator process. Do not enable public sign-up.

## Gate C evidence required before real financial data

1. HTTPS works on the chosen domain; only ports 80/443 are externally reachable.
2. API and database administration ports are not publicly reachable.
3. A user from one company is refused access to another company's data.
4. Hostinger daily server backup coverage and retention are confirmed for the database volume and the permanent application-file bind mount.
5. Restore a Hostinger backup into a disposable isolated environment and prove row counts, key reports, log-in behaviour, and an encrypted employee-document/logo read without touching production.
6. Record the date, operator, backup identifier, restore result, and any corrective action in the governance evidence.

## Noorix migration rehearsal

Do not use a Baseer backup artifact as a Noorix importer. Before the final cutover, run the Noorix migration against a disposable Baseer database, compare the approved counts and financial reports, and record the source export fingerprint. On cutover day, stop Noorix writes, capture a final export, repeat the reconciliation, and only then admit users to Baseer. The source-specific intake manifest and mapping workbook are maintained under `docs/nurix-migration/` and do not contain real credentials or live data.

## Explicitly deferred

- Public registration and multi-tenant SaaS operations.
- A cloud monitoring vendor or external paging service.
- Public launch, domain purchase, firewall changes, and real-data migration. These require a separate owner approval and a completed rehearsal.
