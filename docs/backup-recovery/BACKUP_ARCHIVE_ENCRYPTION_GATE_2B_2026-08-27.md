# Baseer Company Archive Encryption — Gate 2B

**Decision:** `Conditional pass — private encrypted artifact only`  
**Scope:** encrypt and verify the internal company archive artifact. A direct V1 download endpoint exists, but this record is not an upload, import, restore, schedule/retention, or production-release approval.

## Delivered boundary

The worker finalizes its payload only in private staging, then streams it through gzip and AES-256-GCM into one fence-scoped `.bca` file. The final path is:

`encrypted/<tenant-id>/<company-id>/<job-id>/<lease-fence>.bca`

No plaintext directory is published. The former plaintext publication call fails closed. Private staging is removed only after the encrypted artifact has been verified, recorded through the job's fenced database compare-and-set, and marked published.

`BackupArtifact.sha256` and `byteSize` describe the encrypted `.bca` bytes. The manifest SHA-256 is retained only as an internal envelope/payload identity check; it is not substituted for the artifact hash.

**Current eligibility:** artifacts produced by the present allow-list are labelled **`PARTIAL_CONFIGURATION_ONLY`** in operational documentation. They are downloadable encrypted evidence/configuration artifacts, but are **not eligible for restore or restore validation** until a future import gate accepts a complete ownership registry, adapter versions, reconciliation rules, and restore evidence.

## Cryptographic contract

- A new random 32-byte data-encryption key (DEK) is created per artifact.
- Payload encryption is AES-256-GCM with a separate random 96-bit IV.
- The DEK is wrapped with AES-256-GCM by a key-encryption key (KEK), using another independent random 96-bit IV.
- Canonical authenticated data binds format/version, tenant, company, job, worker fence, manifest SHA-256 and key ID. An artifact cannot be moved to another company/job/fence and still verify.
- The bounded canonical header contains only algorithm identifiers, scope, IVs, key ID and wrapped DEK. It does not contain a plaintext DEK/KEK, payload paths, record names, or business rows.
- The container is `BSAE0001 + header length + canonical header + ciphertext + 16-byte GCM tag`. Its record stream is bounded and verified against the manifest, checksums and allowed paths during decryption.
- An Ed25519 signature is deliberately deferred. A private signing key stored beside the KEK in environment configuration would not provide an independent trust boundary. A future KMS/HSM or transport/import gate can add signing with an independently managed key.

This Gate uses a locally provisioned environment KEK keyring and AES-GCM authenticated encryption; it does **not** claim KMS/HSM-backed key custody or an independent digital signature.

## Keyring and rotation

The worker requires `BASEER_ARCHIVE_KEK_KEYRING_V1` as a secret environment value, not an application setting or UI value:

```json
{"activeKeyId":"v2","keys":{"v1":"<base64-32-byte-KEK>","v2":"<base64-32-byte-KEK>"}}
```

Only canonical Base64 keys that decode to exactly 32 bytes are accepted. New artifacts use `activeKeyId`; older artifacts remain verifiable while their `keyId` remains in the keyring. An absent, malformed, unknown, or removed key ID fails closed. Rotate by adding the new key, making it active, retaining required old keys for the retention period, then retiring old keys only after all dependent artifacts are expired or otherwise re-encrypted under an approved procedure. Never write this value into source control, manifests, audit metadata, logs, or UI.

## Interruption and tamper handling

- A unique `.part` is produced below private artifact staging. The final name is created by an atomic no-replace hard link; a competing final name returns an error and is never overwritten.
- The full write path is a stream `pipeline`; source, compression, encryption and output errors reject the package and remove only its `.part`.
- Before final publication, the system decrypts and verifies the full stream, manifest, checksums and payload paths. Header/ciphertext/tag changes, wrong tenant/company/job/fence, wrong/missing keyring and unknown keys fail closed.
- If a process stops after final encrypted publication but before database recording, recovery re-verifies that exact file. A corrupt existing final artifact is rejected and never replaced.
- Orphan encrypted artifacts and private staging are not user-visible. Conservative retention/cleanup scheduling remains a later gate.

## Evidence

- `npm run verify:backup-archive-packager` — package, recovery, no-replace collision, tamper, wrong scope, malformed/unknown/rotated keys and injected source failure.
- `npm run verify:backup-company-archive-worker` — durable worker emits a verified encrypted `.bca`, persists its byte hash/size, and leaves no plaintext published directory.
- `npm run check:company-archive-exporter`, `npm run check:backup-worker`, `npm run verify:backup-gate-1-db` and API TypeScript checks pass locally.

## Still prohibited

The current V1 download is a direct, Bearer-authenticated `backup.download` endpoint for an already-verified encrypted artifact. It is not a signed grant or presigned URL, it rejects `Range` requests, and it streams ciphertext only. There is no download UI action, upload, import, restore-as-new-company, schedule, retention cleanup, production worker enablement, KMS/HSM integration, or production acceptance in this gate.
