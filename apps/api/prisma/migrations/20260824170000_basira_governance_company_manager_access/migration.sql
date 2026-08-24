-- Company managers govern Basira only within their active company. Provider
-- credentials and central system identity remain tenant-owner controls.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", permission_grant."permissionCode"
FROM "Role" AS role
CROSS JOIN (
  VALUES
    ('platform.ai.context.read'),
    ('platform.ai.context.write'),
    ('platform.ai.skills.read'),
    ('platform.ai.skills.activate'),
    ('platform.ai.receipts.read'),
    ('platform.ai.evaluations.read'),
    ('platform.ai.evaluations.write')
) AS permission_grant("permissionCode")
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
