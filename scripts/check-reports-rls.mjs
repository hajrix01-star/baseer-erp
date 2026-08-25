import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationsPath = "apps/api/prisma/migrations";
const reportsPath = "apps/api/src/reports";
const schema = readFileSync(schemaPath, "utf8");
const migrations = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(migrationsPath, entry.name, "migration.sql"))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const prismaModelByDelegate = {
  auditEvent: "AuditEvent",
  company: "Company",
  companyFinanceProfile: "CompanyFinanceProfile",
  financeAccount: "FinanceAccount",
  financeCashPerformanceCoverage: "FinanceCashPerformanceCoverage",
  financeCashPerformanceEvent: "FinanceCashPerformanceEvent",
  financeCashPerformanceHistoricalImport: "FinanceCashPerformanceHistoricalImport",
  financeCategory: "FinanceCategory",
  financeDailySalesClosing: "FinanceDailySalesClosing",
  financeJournalEntry: "FinanceJournalEntry",
  financeJournalLine: "FinanceJournalLine",
  financeLedgerRevision: "FinanceLedgerRevision",
  financeOutflowDocument: "FinanceOutflowDocument",
  financeSupplierDuePayment: "FinanceSupplierDuePayment",
  financeVatSettlement: "FinanceVatSettlement",
  financeVault: "FinanceVault",
  hrPayrollPayment: "HrPayrollPayment",
  reportDocument: "ReportDocument",
  reportRun: "ReportRun",
  vatSimulation: "VatSimulation",
};

const sourceFiles = readdirSync(reportsPath, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
  .map((entry) => join(reportsPath, entry.name));
const delegates = new Set();
for (const path of sourceFiles) {
  for (const match of readFileSync(path, "utf8").matchAll(/\btransaction\.([A-Za-z][A-Za-z0-9_]*)\b/g)) delegates.add(match[1]);
}
const unknownDelegates = [...delegates].filter((delegate) => !prismaModelByDelegate[delegate]);
if (unknownDelegates.length) {
  throw new Error(`Reports accesses Prisma delegate(s) without an RLS mapping: ${unknownDelegates.sort().join(", ")}.`);
}
const protectedModels = [...new Set([...delegates].map((delegate) => prismaModelByDelegate[delegate]))].sort();
if (!protectedModels.includes("ReportRun") || !protectedModels.includes("ReportDocument")) {
  throw new Error("Reports RLS coverage must include both ReportRun and ReportDocument.");
}

const tenantPredicate = /"tenantId"\s*=\s*(?:NULLIF\s*\(\s*current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s*,\s*''\s*\)|current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\))\s*::uuid/i;
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

for (const table of protectedModels) {
  const modelBlock = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  if (!/^\s*tenantId\s+String\s+@db\.Uuid\s*$/m.test(modelBlock)) {
    throw new Error(`${table} must expose tenantId as UUID before Reports may access it.`);
  }
  const escapedTable = escapeRegExp(table);
  if (!new RegExp(`ALTER\\s+TABLE\\s+"${escapedTable}"\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i").test(migrations)) {
    throw new Error(`${table} is missing ENABLE ROW LEVEL SECURITY.`);
  }
  if (!new RegExp(`ALTER\\s+TABLE\\s+"${escapedTable}"\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY\\s*;`, "i").test(migrations)) {
    throw new Error(`${table} is missing FORCE ROW LEVEL SECURITY.`);
  }
  const policy = new RegExp(`CREATE\\s+POLICY\\s+"[^"]+"\\s+ON\\s+"${escapedTable}"\\s+USING\\s*\\(([\\s\\S]*?)\\)\\s+WITH\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*;`, "i").exec(migrations);
  if (!policy || !tenantPredicate.test(policy[1]) || !tenantPredicate.test(policy[2])) {
    throw new Error(`${table} must have matching tenant USING and WITH CHECK policy predicates.`);
  }
}

console.log(`Reports RLS verified for ${protectedModels.length} models reached by apps/api/src/reports (ENABLE + FORCE + tenant USING/WITH CHECK).`);
