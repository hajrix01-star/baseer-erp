# Private online file storage and recovery

## Decision and boundary

BASEER ERP stores application files on the same private server as the API. The
API container remains read-only except for one explicit bind mount:

```text
BASEER_STORAGE_HOST_PATH (host)
  ├── hr/       encrypted employee-document blobs
  ├── logos/    company branding files
  └── inbound/  encrypted Gmail evidence when that optional feature is enabled
       ↳ /var/lib/baseer/storage (API container)
```

This directory must not be a web root, Docker source checkout, database volume,
or a path shared with another service. The database keeps metadata and hashes;
it is not the file store.

## One-time host preparation

On the private server, create the directory named by `BASEER_STORAGE_HOST_PATH`
and the three child directories (`hr`, `logos`, `inbound`). Give only the Docker
API runtime user (uid `1000` in the supplied image) and the owner-controlled
backup process read/write access. Do not place secrets in the compose file or
repository; put them in `ops/private-online/.env.private-online` with owner-only
permissions.

The compose configuration will refuse to start the production API unless the
mount and its required `hr` and `logos` directories are readable and writable.
It also requires a canonical 32-byte Base64 employee-document key and an HTTP(S)
scanner endpoint. Gmail remains disabled by default; enabling it requires its
own storage directory, encryption keys, and a callback on the configured HTTPS
public domain.

## Pre-release file check

1. Start the stack only after a backup checkpoint exists.
2. Confirm `api` becomes healthy at `/v1/health/ready` and Docker retains no
   more than five local 10 MiB log files per service.
3. Upload a safe PDF as an employee document; confirm it becomes downloadable
   only after the scanner returns `READY`.
4. Verify a rejected file and an unavailable scanner remain quarantined.
5. Restart only the API and download the safe file again. This proves the bind
   mount, not an ephemeral container filesystem, is being used.
6. Repeat with a company logo. If Gmail is enabled, repeat with one non-sensitive
   test attachment.
7. Record the release SHA, operator, timestamp, scanner outcome, and resulting
   metadata IDs in the release evidence; do not record contents or keys.

## Backup and isolated restore

The server-backup policy must include **both** the PostgreSQL Docker volume and
`BASEER_STORAGE_HOST_PATH`. Keep one encrypted copy on an owner-controlled
separate medium or second machine; a backup only on the same server is not a
recovery boundary against server loss.

For every release candidate, restore the database and file directory into an
isolated disposable environment. Validate migrations, login, company isolation,
one employee-document download, one company-logo read, and the checksum/size
recorded in `FileMetadata`. Never restore over the running production stack.

The release evidence must retain the backup identifier, restore target, date,
operator, row-count/reconciliation result, file checks, and the chosen rollback
image tag. A subscription or successful backup job alone is not proof of
restorability.
