import { readFileSync } from "node:fs";

const migration = readFileSync("apps/api/prisma/migrations/20260826090000_backup_gate_1_foundation/migration.sql", "utf8");
const service = readFileSync("apps/api/src/backup/backup.service.ts", "utf8");
const controller = readFileSync("apps/api/src/backup/backup.controller.ts", "utf8");
const permissions = readFileSync("apps/api/src/administration/administration-permissions.ts", "utf8");

const tables = ["BackupPolicy", "BackupJob", "BackupArtifact", "BackupAuditEvent"];
for (const table of tables) {
  for (const clause of [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY "${table}_tenant_isolation"`,
  ]) {
    if (!migration.includes(clause)) throw new Error(`Backup Gate 1 must tenant-isolate ${table}: missing ${clause}`);
  }
}

for (const clause of [
  "CREATE TRIGGER \"BackupAuditEvent_append_only\"",
  "BEFORE UPDATE OR DELETE ON \"BackupAuditEvent\"",
  "pg_advisory_xact_lock",
  "idempotencyKey",
  "backup.audit.view",
  "backup.create",
  "backup.read",
]) {
  const source = clause.startsWith("backup.") ? permissions + controller : migration + service;
  if (!source.includes(clause)) throw new Error(`Backup Gate 1 control is missing: ${clause}`);
}

if (service.includes("pg_dump") || service.includes("pg_restore"))
  throw new Error("Gate 1 must not implement live database export or restore.");

console.log("Backup Gate 1 foundation controls verified.");
