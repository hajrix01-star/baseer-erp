-- Cancellation has a separate capability from moving money between vaults.
-- Existing system roles retain their intended authority; custom roles are not
-- expanded implicitly and must be granted this sensitive action deliberately.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT roles."tenantId", roles."id", 'finance.vaults.cancel'
FROM "Role" AS roles
WHERE roles."code" IN ('BASEER_COMPANY_MANAGER', 'BASEER_FINANCE_ACCOUNTANT')
  AND roles."isSystem" = true
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
