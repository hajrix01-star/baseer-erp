# BASEER ERP private online deployment and recovery rehearsal

## Boundaries

This package is for the owner's private BASEER ERP and the owner's companies. It is not a SaaS service and it must not offer public account registration. The application name remains **BASEER ERP**. The public domain is a deployment setting and can change without renaming the application.

Only the reverse proxy exposes HTTPS. PostgreSQL has no host port and remains on an internal Docker network. Docker administration, database access, backups, and source access remain private to the owner or explicitly authorised operators.

## Files supplied

- `Dockerfile`: repeatable API image build.
- `docker-compose.private-online.yml`: private API, internal PostgreSQL, and HTTPS reverse proxy.
- `docker/Caddyfile.private-online`: HTTPS reverse proxy configuration; certificates are handled by Caddy after DNS points to the selected domain.
- `ops/private-online/.env.private-online.example`: non-secret configuration template.
- `docker/baseer-private-init/10-create-baseer-app.sh`: creates a non-superuser database application role on the first empty database volume.

## Before the first private deployment

1. Choose the owner-controlled server and an encrypted, physically separate backup device. Do not use the database volume itself as the backup.
2. Choose any available domain and point its DNS records to the private server. The domain may change later; **BASEER ERP** remains the product name.
3. Copy `ops/private-online/.env.private-online.example` to `ops/private-online/.env.private-online`; replace every placeholder with unique secrets stored outside the repository.
4. Build the API image locally; this does not start the services:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml build api
   ```

5. Run database migrations with the separate bootstrap service, then grant only the required schema/table/sequence privileges to `BASEER_DB_APP_USER`:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml run --rm migrate
   .\scripts\Grant-BaseerPrivateAppAccess.ps1
   ```

   The API must run only with `BASEER_DB_APP_USER`, never `postgres`.
6. Start the private stack only after the preceding review:

   ```powershell
   docker compose --env-file ops/private-online/.env.private-online -f docker-compose.private-online.yml up -d
   ```

7. Create users only through the approved administrator process. Do not enable public sign-up.

## Gate C evidence required before real financial data

1. HTTPS works on the chosen domain; only ports 80/443 are externally reachable.
2. API and database administration ports are not publicly reachable.
3. A user from one company is refused access to another company's data.
4. The backup is encrypted and copied to the separate owner-controlled device.
5. Restore that backup into a disposable isolated database and prove row counts, key reports, and log-in behaviour without touching production.
6. Record the date, operator, backup identifier, restore result, and any corrective action in the governance evidence.

## Explicitly deferred

- Public registration and multi-tenant SaaS operations.
- A cloud monitoring vendor or external paging service.
- Public launch, domain purchase, firewall changes, and real-data migration. These require a separate owner approval and a completed rehearsal.
