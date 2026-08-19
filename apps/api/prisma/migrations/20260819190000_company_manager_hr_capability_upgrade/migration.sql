-- Existing system company-manager roles were created before the fine-grained
-- HR capabilities. Upgrade that system template only; custom roles remain
-- explicit and are never broadened by this data migration.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT roles."tenantId", roles."id", capabilities."permissionCode"
FROM "Role" AS roles
CROSS JOIN (
  VALUES
    ('hr.employees.read'),
    ('hr.employees.write'),
    ('hr.advances.read'),
    ('hr.advances.issue'),
    ('hr.advances.settle'),
    ('hr.advances.reverse'),
    ('hr.deductions.manage'),
    ('hr.leaves.read'),
    ('hr.leaves.manage'),
    ('hr.payroll.read'),
    ('hr.payroll.create'),
    ('hr.payroll.approve'),
    ('hr.payroll.pay'),
    ('hr.payroll.reverse'),
    ('hr.employee_documents.read'),
    ('hr.employee_documents.write'),
    ('hr.employee_documents.revoke'),
    ('hr.employee_documents.download'),
    ('hr.employee_letters.read'),
    ('hr.employee_letters.issue'),
    ('hr.employee_letters.revoke'),
    ('hr.final_settlements.read'),
    ('hr.final_settlements.create'),
    ('hr.final_settlements.verify'),
    ('hr.final_settlements.approve'),
    ('hr.final_settlements.pay'),
    ('hr.final_settlements.reverse')
) AS capabilities("permissionCode")
WHERE roles."code" = 'BASEER_COMPANY_MANAGER'
  AND roles."isSystem" = true
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
