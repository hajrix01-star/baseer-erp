-- Report discovery is capability-gated on the server; existing standard roles
-- receive the read-only capability without gaining any financial write path.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", 'reports.read'
FROM "Role" role
WHERE role."code" IN ('BASEER_COMPANY_MANAGER', 'BASEER_FINANCE_ACCOUNTANT', 'BASEER_READER')
ON CONFLICT DO NOTHING;
