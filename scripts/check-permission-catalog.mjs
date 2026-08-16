import { readFileSync } from "node:fs";

const source = readFileSync("apps/api/src/administration/administration-permissions.ts", "utf8");
const catalog = new Set([...source.matchAll(/code:\s*"([^"]+)"/g)].map((match) => match[1]));
const required = [
  "finance.setup.write", "finance.configuration.read", "finance.periods.write", "finance.vaults.write",
  "finance.foundation.write", "finance.suppliers.read", "finance.supplier_dues.read", "finance.supplier_dues.write",
  "finance.loans.write", "finance.daily_sales.read", "finance.daily_sales.history.read_all", "finance.daily_sales.create",
  "finance.daily_sales.correct", "finance.daily_sales.reverse", "finance.operational_calendar.manage",
  "platform.files.read", "platform.files.write", "platform.business-date.read", "platform.observability.read",
  "platform.output.preview", "platform.output.export", "platform.ai.configuration.read", "platform.ai.configuration.write",
  "platform.ai.provider.configure", "platform.ai.identity.read", "platform.ai.identity.write",
  "platform.ai.identity.create_version", "platform.ai.system_identity.read", "platform.ai.system_identity.write",
  "platform.ai.system_identity.create_version",
];
const missing = required.filter((code) => !catalog.has(code));
if (missing.length) throw new Error(`Permission catalogue is missing server capabilities: ${missing.join(", ")}`);
console.log(`Permission catalogue verified (${catalog.size} capabilities).`);