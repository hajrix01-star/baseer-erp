-- A lease owner alone is not sufficient: an expired worker can still be alive.
-- The monotonically increasing fence makes every durable worker write prove it
-- still owns the current claim for that job.
ALTER TABLE "BackupJob"
  ADD COLUMN "workerLeaseFence" BIGINT NOT NULL DEFAULT 0;
