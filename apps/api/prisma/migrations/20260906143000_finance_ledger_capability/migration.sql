-- The unified financial register has its own discovery and API capability.
-- Preserve the established scope of system roles only; custom roles stay
-- least-privilege until their administrator explicitly grants the new code.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", 'finance.ledger.read'
FROM "Role" AS role
WHERE role."code" IN ('BASEER_COMPANY_MANAGER', 'BASEER_FINANCE_ACCOUNTANT', 'BASEER_READER')
  AND role."isSystem" = true
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
