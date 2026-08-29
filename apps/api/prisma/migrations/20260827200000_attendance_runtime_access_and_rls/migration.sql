-- Attendance is tenant-scoped operational data. The runtime role must be able
-- to write the check-in records as well as read their configuration; local
-- migration environments may not have default privileges for newly added
-- tables, so repair that grant explicitly and safely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "AttendanceBranch",
      "AttendanceEmployeeCredential",
      "AttendanceWorkSession",
      "AttendanceEvent"
    TO baseer_app;
  END IF;
END;
$$;

ALTER TABLE "AttendanceBranch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceBranch" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceEmployeeCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceEmployeeCredential" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceWorkSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceWorkSession" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceEvent" FORCE ROW LEVEL SECURITY;

-- This migration was safely applied to an already-running local staging
-- database during incident recovery. Removing an existing same-name policy
-- makes a subsequent normal Prisma deployment converge cleanly as well.
DROP POLICY IF EXISTS "AttendanceBranch_tenant_isolation" ON "AttendanceBranch";
DROP POLICY IF EXISTS "AttendanceEmployeeCredential_tenant_isolation" ON "AttendanceEmployeeCredential";
DROP POLICY IF EXISTS "AttendanceWorkSession_tenant_isolation" ON "AttendanceWorkSession";
DROP POLICY IF EXISTS "AttendanceEvent_tenant_isolation" ON "AttendanceEvent";

CREATE POLICY "AttendanceBranch_tenant_isolation" ON "AttendanceBranch"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AttendanceEmployeeCredential_tenant_isolation" ON "AttendanceEmployeeCredential"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AttendanceWorkSession_tenant_isolation" ON "AttendanceWorkSession"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AttendanceEvent_tenant_isolation" ON "AttendanceEvent"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
