-- Existing system company-manager roles may predate the read capability for
-- employee deductions. Upgrade only that immutable system template; custom
-- roles remain explicit and are not broadened by this data migration.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT roles."tenantId", roles."id", 'hr.deductions.read'
FROM "Role" AS roles
WHERE roles."code" = 'BASEER_COMPANY_MANAGER'
  AND roles."isSystem" = true
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
