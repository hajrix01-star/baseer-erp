import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsPath = "apps/api/prisma/migrations";
const schema = readFileSync(schemaPath, "utf8");
const migrations = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(migrationsPath, entry.name, "migration.sql"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const financeModels = [...schema.matchAll(/^model (Finance\w+) \{/gm)].map((match) => match[1]);
if (financeModels.length === 0) throw new Error(`No Finance models were found in ${schemaPath}.`);
if (new Set(financeModels).size !== financeModels.length) throw new Error("Duplicate Finance model names were found in the Prisma schema.");

const tenantPredicate = /"tenantId"\s*=\s*(?:NULLIF\s*\(\s*current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s*,\s*''\s*\)|current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\))\s*::uuid/i;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const table of financeModels) {
  const modelBlock = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  if (!/^\s*tenantId\s+String\s+@db\.Uuid\s*$/m.test(modelBlock)) {
    throw new Error(`${table} must expose a tenantId UUID before it can use the shared Finance RLS policy.`);
  }

  const escapedTable = escapeRegExp(table);
  const enabled = new RegExp(`ALTER\\s+TABLE\\s+"${escapedTable}"\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i");
  const forced = new RegExp(`ALTER\\s+TABLE\\s+"${escapedTable}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i");
  if (!enabled.test(migrations)) throw new Error(`Finance migration history is missing ENABLE ROW LEVEL SECURITY for ${table}.`);
  if (!forced.test(migrations)) throw new Error(`Finance migration history is missing FORCE ROW LEVEL SECURITY for ${table}.`);

  const policy = new RegExp(`CREATE\\s+POLICY\\s+"[^"]+"\\s+ON\\s+"${escapedTable}"\\s+USING\\s*\\(([\\s\\S]*?)\\)\\s+WITH\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i").exec(migrations);
  if (!policy || !tenantPredicate.test(policy[1]) || !tenantPredicate.test(policy[2])) {
    throw new Error(`${table} must have a tenant policy with matching USING and WITH CHECK predicates.`);
  }
}

const protectedTables = [...migrations.matchAll(/CREATE\s+POLICY\s+"[^"]+"\s+ON\s+"(Finance\w+)"/gi)].map((match) => match[1]);
const unexpected = protectedTables.filter((table) => !financeModels.includes(table));
const duplicates = protectedTables.filter((table, index) => protectedTables.indexOf(table) !== index);
if (unexpected.length) throw new Error(`Finance RLS migration contains tables absent from Prisma: ${unexpected.join(", ")}`);
if (duplicates.length) throw new Error(`Finance RLS migration contains duplicate policies: ${[...new Set(duplicates)].join(", ")}`);
if (protectedTables.length !== financeModels.length) {
  throw new Error(`Finance RLS coverage mismatch: ${protectedTables.length} policies for ${financeModels.length} Prisma Finance models.`);
}

console.log(`Finance RLS verified for ${financeModels.length} Prisma models (ENABLE + FORCE + tenant policy).`);
