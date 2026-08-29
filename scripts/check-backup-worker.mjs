import { readFileSync } from 'node:fs';

const worker = readFileSync('apps/api/src/backup/backup-worker.service.ts', 'utf8');
const schema = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
const migration = readFileSync('apps/api/prisma/migrations/20260826090000_backup_gate_1_foundation/migration.sql', 'utf8');
const fencingMigration = readFileSync('apps/api/prisma/migrations/20260827090000_backup_worker_fencing/migration.sql', 'utf8');
const moduleSource = readFileSync('apps/api/src/app.module.ts', 'utf8');

for (const requirement of [
  'BASEER_BACKUP_WORKER_ENABLED',
  'workerLeaseOwnerId',
  'workerLeaseExpiresAt',
  'workerHeartbeatAt',
  'updateMany',
  'renewLease',
  'releaseLease',
  'CompanyArchiveExporter',
]) {
  if (!worker.includes(requirement)) throw new Error(`Backup worker control is missing: ${requirement}`);
}

if (worker.includes('withSystemSchedulerLock')) throw new Error('A long-lived archive export must not hold a system scheduler lock.');
for (const requirement of ['workerLeaseOwnerId', 'workerLeaseExpiresAt', 'workerHeartbeatAt']) {
  if (!schema.includes(requirement) || !migration.includes(requirement)) throw new Error(`Backup job durable lease field is missing: ${requirement}`);
}
if (!schema.includes('workerLeaseFence') || !fencingMigration.includes('workerLeaseFence')) throw new Error('Backup job durable lease fence is missing.');
if (!moduleSource.includes('BackupWorkerService') || !moduleSource.includes('CompanyArchiveExporter')) {
  throw new Error('Backup exporter and worker must be registered providers.');
}

console.log('Backup worker lease and opt-in controls verified.');
