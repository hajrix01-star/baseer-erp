import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsPath = "apps/api/prisma/migrations";
const commandCenterPath = "apps/web/src/command-center-sales-calendar.tsx";
const calendarPath = "apps/api/src/finance/operational-calendar.service.ts";
const schema = readFileSync(schemaPath, "utf8");
const migrations = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8"))
  .join("\n");
const commandCenter = readFileSync(commandCenterPath, "utf8");
const calendar = readFileSync(calendarPath, "utf8");

// Command Center currently exposes one deliberately read-only slice.  Keep this
// guard narrow: it protects the models reached by listCalendar, without making
// write-only operational-calendar implementation details part of this module.
if (!/`\/finance\/operational-calendar\?\$\{(?:query|baseerPeriodQuery\(range\))\}`/.test(commandCenter)) {
  throw new Error("Command Center must use the server-owned operational-calendar read endpoint.");
}
if (!/async listCalendar\([\s\S]*?transaction\.financeOperationalDay\.findMany\([\s\S]*?transaction\.financeDailyFinancialSummary\.findMany\(/.test(calendar)) {
  throw new Error("Command Center calendar read models changed; update its RLS coverage deliberately.");
}

const models = ["FinanceOperationalDay", "FinanceDailyFinancialSummary"];
const tenantPredicate = /"tenantId"\s*=\s*(?:NULLIF\s*\(\s*current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s*,\s*''\s*\)|current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\))\s*::uuid/i;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const table of models) {
  const modelBlock = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  if (!/^\s*tenantId\s+String\s+@db\.Uuid\s*$/m.test(modelBlock)) {
    throw new Error(`${table} must expose tenantId as UUID.`);
  }
  const escaped = escapeRegExp(table);
  if (!new RegExp(`ALTER\\s+TABLE\\s+"${escaped}"\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i").test(migrations)) {
    throw new Error(`${table} is missing ENABLE ROW LEVEL SECURITY.`);
  }
  if (!new RegExp(`ALTER\\s+TABLE\\s+"${escaped}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i").test(migrations)) {
    throw new Error(`${table} is missing FORCE ROW LEVEL SECURITY.`);
  }
  const policy = new RegExp(`CREATE\\s+POLICY\\s+"[^"]+"\\s+ON\\s+"${escaped}"\\s+USING\\s*\\(([\\s\\S]*?)\\)\\s+WITH\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i").exec(migrations);
  if (!policy || !tenantPredicate.test(policy[1]) || !tenantPredicate.test(policy[2])) {
    throw new Error(`${table} must have tenant-protecting USING and WITH CHECK policy predicates.`);
  }
}

console.log(`Command Center RLS verified for ${models.length} read models reached by the operational calendar (tenant UUID, ENABLE + FORCE + USING/WITH CHECK).`);
