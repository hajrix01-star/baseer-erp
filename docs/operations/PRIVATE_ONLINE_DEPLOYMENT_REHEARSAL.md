# BASEER ERP private online deployment and recovery rehearsal

## Boundaries

This package is for the owner's private BASEER ERP and the owner's companies. It is not a SaaS service and it must not offer public account registration. The application name remains **BASEER ERP**. The public domain is a deployment setting and can change without renaming the application.

Only the reverse proxy exposes HTTPS. PostgreSQL has no host port and remains on an internal Docker network. Docker administration, database access, backups, and source access remain private to the owner or explicitly authorised operators.

## Files supplied

- `Dockerfile`: separate `runtime` API image and short-lived `migrate` image.
- `docker-compose.private-online.yml`: private API, internal PostgreSQL, and HTTPS reverse proxy.
- `docker/Caddyfile.private-online`: HTTPS reverse proxy configuration; certificates are handled by Caddy after DNS points to the selected domain.
- `ops/private-online/.env.private-online.example`: non-secret configuration template.
- `docs/operations/PRIVATE_ONLINE_FILE_STORAGE_AND_RECOVERY.md`: same-server
  bind-mount, file-encryption, scanner, backup, and isolated-restore procedure.
- `docker/baseer-private-init/10-create-baseer-app.sh`: creates a non-superuser database application role on the first empty database volume.

## Before the first private deployment

1. Choose the owner-controlled Hostinger server and subscribe to Hostinger daily server backups. Do not treat the live database volume itself as a backup. The adopted policy is recorded in `HOSTINGER_PRIVATE_HOSTING_AND_BACKUP_DECISION_2026-08-16.md`.
2. Choose any available domain and point its DNS records to the private server. The domain may change later; **BASEER ERP** remains the product name.
3. Copy `ops/private-online/.env.private-online.example` to `ops/private-online/.env.private-online`; replace every placeholder with unique secrets stored outside the repository. Prepare the permanent same-server file-storage bind mount before startup as described in `PRIVATE_ONLINE_FILE_STORAGE_AND_RECOVERY.md`. Create `backup-archives/` beneath it with write access for uid 1000; it is private encrypted archive storage and must never be reverse-proxy served. Keep archive worker and scheduler switches `false` until their isolated recovery rehearsal is accepted.
4. Build the API runtime and migration images locally; this does not start the services:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml build api migrate
   ```

5. Run database migrations with the separate bootstrap service, then grant only the required schema/table/sequence privileges to `BASEER_DB_APP_USER`:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml run --rm migrate
   .\scripts\Grant-BaseerPrivateAppAccess.ps1
   ```

   The API must run only with `BASEER_DB_APP_USER`, never `postgres`. The
   `migrate` job has the bootstrap database credential, no public listener,
   and exits after `prisma migrate deploy`; it must not be kept running.

   The public `api` image intentionally excludes the Prisma CLI,
   `@prisma/config`, and `deepmerge-ts`. This boundary is checked while the
   image builds, so a future dependency change cannot silently put migration
   tooling back into the API container.

6. The release order is mandatory: backup/restore gate → successful `migrate`
   job → migration status plus restricted-application-role/RLS verification →
   API rollout. A failed migration or verification stops the rollout; the
   compose profile deliberately does not start the API after migrations by
   itself. The migration job is read-only except for its temporary filesystem,
   has no public port, uses `no-new-privileges`, and has access only to the
   database network.

7. Start the private stack only after the preceding review:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml up -d
   ```

8. Create users only through the approved administrator process. Do not enable public sign-up.

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
