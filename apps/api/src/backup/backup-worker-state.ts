import { BackupJobStatus } from '../generated/prisma/client.js';

export type BackupWorkerStage =
  | 'PRECHECK'
  | 'CONSISTENT_SNAPSHOT'
  | 'EXPORT_DATA'
  | 'EXPORT_ATTACHMENTS'
  | 'PACKAGE_COMPRESS_ENCRYPT'
  | 'VERIFY_HASHES'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELLED';

export type BackupWorkerTransition = Readonly<{
  stage: BackupWorkerStage;
  progressPercent: number;
  recordsProcessed?: number;
  recordsTotal?: number | null;
  bytesProcessed?: bigint;
  bytesTotal?: bigint | null;
  checkpoint: Record<string, unknown>;
  error?: Readonly<{ code: string; message: string }>;
}>;

const ORDER: readonly BackupWorkerStage[] = ['PRECHECK', 'CONSISTENT_SNAPSHOT', 'EXPORT_DATA', 'EXPORT_ATTACHMENTS', 'PACKAGE_COMPRESS_ENCRYPT', 'VERIFY_HASHES', 'PUBLISHED'];
const TERMINAL = new Set<BackupWorkerStage>(['PUBLISHED', 'FAILED', 'CANCELLED']);

export function statusForWorkerStage(stage: BackupWorkerStage): BackupJobStatus {
  return BackupJobStatus[stage];
}

/** Validates persisted worker transitions before any database mutation. */
export function assertBackupWorkerTransition(currentStage: string, transition: BackupWorkerTransition): void {
  if (!Number.isInteger(transition.progressPercent) || transition.progressPercent < 0 || transition.progressPercent > 100) throw new TypeError('Backup progress must be an integer from 0 to 100.');
  if (transition.recordsProcessed !== undefined && (!Number.isSafeInteger(transition.recordsProcessed) || transition.recordsProcessed < 0)) throw new TypeError('Processed record count is invalid.');
  if (transition.recordsTotal !== undefined && transition.recordsTotal !== null && (!Number.isSafeInteger(transition.recordsTotal) || transition.recordsTotal < 0)) throw new TypeError('Total record count is invalid.');
  if (transition.recordsTotal !== undefined && transition.recordsTotal !== null && transition.recordsProcessed !== undefined && transition.recordsProcessed > transition.recordsTotal) throw new TypeError('Processed records exceed the total.');
  if (transition.bytesProcessed !== undefined && transition.bytesProcessed < 0n) throw new TypeError('Processed byte count is invalid.');
  if (transition.bytesTotal !== undefined && transition.bytesTotal !== null && transition.bytesTotal < 0n) throw new TypeError('Total byte count is invalid.');
  if (transition.bytesTotal !== undefined && transition.bytesTotal !== null && transition.bytesProcessed !== undefined && transition.bytesProcessed > transition.bytesTotal) throw new TypeError('Processed bytes exceed the total.');
  if (transition.stage === 'FAILED' && (!transition.error || !transition.error.code || !transition.error.message)) throw new TypeError('A failed backup transition requires a stable error code and message.');
  if (transition.stage !== 'FAILED' && transition.error) throw new TypeError('Only a failed backup transition may include an error.');
  if (TERMINAL.has(currentStage as BackupWorkerStage)) throw new TypeError('Terminal backup jobs cannot transition.');
  if (transition.stage === 'FAILED' || transition.stage === 'CANCELLED') return;
  const currentIndex = currentStage === 'QUEUED' ? -1 : ORDER.indexOf(currentStage as BackupWorkerStage);
  const nextIndex = ORDER.indexOf(transition.stage);
  if (currentIndex < -1 || nextIndex < 0 || nextIndex !== currentIndex + 1) throw new TypeError(`Invalid backup transition from ${currentStage} to ${transition.stage}.`);
  if (transition.stage === 'PUBLISHED' && transition.progressPercent !== 100) throw new TypeError('Published backup jobs must report 100 percent progress.');
}
