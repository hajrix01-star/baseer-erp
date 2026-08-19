import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsPath = "apps/api/prisma/migrations";
const schema = readFileSync(schemaPath, "utf8");
const migrationSources = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(migrationsPath, entry.name, "migration.sql"))
  .map((path) => readFileSync(path, "utf8"));
const migrations = migrationSources.join("\n");

const hrModels = [...schema.matchAll(/^model (Hr\w+) \{/gm)].map((match) => match[1]);
if (hrModels.length === 0) throw new Error(`No HR models were found in ${schemaPath}.`);
if (new Set(hrModels).size !== hrModels.length) throw new Error("Duplicate HR model names were found in the Prisma schema.");

const tenantPredicate = `"tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
for (const table of hrModels) {
  const modelBlock = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  if (!/^\s*tenantId\s+String\s+@db\.Uuid\s*$/m.test(modelBlock)) {
    throw new Error(`${table} must expose a tenantId UUID before it can use the shared HR RLS policy.`);
  }

  const requiredStatements = [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY "${table}_tenant_isolation" ON "${table}" USING (${tenantPredicate}) WITH CHECK (${tenantPredicate});`,
  ];
  for (const statement of requiredStatements) {
    if (!migrations.includes(statement)) throw new Error(`HR migration history is missing: ${statement}`);
  }
}

const protectedTables = [...migrations.matchAll(/CREATE POLICY "Hr\w+_tenant_isolation" ON "(Hr\w+)"/g)].map((match) => match[1]);
const unexpected = protectedTables.filter((table) => !hrModels.includes(table));
const duplicates = protectedTables.filter((table, index) => protectedTables.indexOf(table) !== index);
if (unexpected.length) throw new Error(`HR RLS migration contains tables absent from Prisma: ${unexpected.join(", ")}`);
if (duplicates.length) throw new Error(`HR RLS migration contains duplicate policies: ${[...new Set(duplicates)].join(", ")}`);
if (protectedTables.length !== hrModels.length) {
  throw new Error(`HR RLS coverage mismatch: ${protectedTables.length} policies for ${hrModels.length} Prisma HR models.`);
}

console.log(`HR RLS verified for ${hrModels.length} Prisma models (ENABLE + FORCE + tenant policy).`);
