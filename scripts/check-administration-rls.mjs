import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsPath = "apps/api/prisma/migrations";
const protectedModels = [
  "User",
  "Company",
  "Role",
  "RolePermission",
  "CompanyMembership",
  "AppSession",
  "AuditEvent",
  "TenantAdministrationAssignment",
  "CompanyBranding",
];
const schema = readFileSync(schemaPath, "utf8");
const migrations = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(migrationsPath, entry.name, "migration.sql"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const tenantPredicate = /"tenantId"\s*=\s*(?:NULLIF\s*\(\s*current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s*,\s*''\s*\)|current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\))\s*::uuid/i;

for (const table of protectedModels) {
  const modelBlock = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  if (!/^\s*tenantId\s+String\s+@db\.Uuid\s*$/m.test(modelBlock)) throw new Error(`${table} must expose tenantId as UUID.`);
  if (!new RegExp(`ALTER\\s+TABLE\\s+"${table}"\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i").test(migrations)) throw new Error(`${table} is missing ENABLE RLS.`);
  if (!new RegExp(`ALTER\\s+TABLE\\s+"${table}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i").test(migrations)) throw new Error(`${table} is missing FORCE RLS.`);
  const policy = new RegExp(`CREATE\\s+POLICY\\s+"[^"]+"\\s+ON\\s+"${table}"\\s+USING\\s*\\(([\\s\\S]*?)\\)\\s+WITH\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i").exec(migrations);
  if (!policy || !tenantPredicate.test(policy[1]) || !tenantPredicate.test(policy[2])) throw new Error(`${table} must have matching tenant USING and WITH CHECK policy predicates.`);
}

console.log(`Administration RLS verified for ${protectedModels.length} identity and administration models (ENABLE + FORCE + tenant policy).`);
