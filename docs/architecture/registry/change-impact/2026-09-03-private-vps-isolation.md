# BASEER-IMPACT-2026-09-03-PRIVATE-VPS-ISOLATION

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `ARCHITECTURAL` (deployment and cross-application boundary).
- **Target:** owner-controlled Hostinger VPS at `77.37.51.67`, which already hosts Noorix and possibly other applications.
- **Decision:** deploy BASEER as an independent Compose project with its own internal Docker network, PostgreSQL volume, permanent encrypted file-storage bind mount, backup archive location, secrets file, and Caddy site configuration. It must not join or reuse Noorix containers, volumes, database credentials, networks, or application secrets.
- **Cutover invariant:** Noorix remains running and receives no Baseer deployment changes. Baseer first proves HTTPS and health on a dedicated subdomain; root-domain DNS changes happen only after release evidence and independent delivery review.

## Scope and gates

- **G0:** acceptance is a non-disruptive isolated stack with only 80/443 exposed through the approved proxy boundary; no database or admin port is public.
- **G1:** production capacity is the existing VPS; disk headroom, memory headroom, backup coverage, and co-hosted process inventory must be measured before startup.
- **G2–G4:** API, schema, financial truth, authorization, and UI are unchanged. Isolation is operational only.
- **G5–G7:** require immutable CI image digests, release-manifest preflight, isolated Compose validation, migration/grant success, health checks, and zero impact to existing containers.
- **G8:** `$alpha-delivery-team` independently verifies HTTPS, isolation, backup/restore evidence, and company-access denial before any root-domain cutover.

## Rollback

Stop only the `baseer` Compose project and leave its volumes intact for diagnosis. Do not stop, rename, reuse, or modify Noorix resources. DNS remains on the existing Noorix target until the approved cutover.
