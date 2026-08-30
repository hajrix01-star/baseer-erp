import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const permissions = read("apps/api/src/administration/administration-permissions.ts");
const context = read("apps/api/src/company-context/company-context.service.ts");
const access = read("apps/api/src/company-context/company-access.service.ts");
const catalog = read("apps/api/src/operations/operations-catalog.controller.ts");
const execution = read("apps/api/src/operations/operations-execution.controller.ts");

for (const capability of ["finance.categories.write", "finance.suppliers.write"]) {
  assert.match(permissions, new RegExp(`code: "${capability}"`), `${capability} must be assignable from the server permission catalogue.`);
}
assert.match(context, /MIGRATION_REVIEW_READ_CAPABILITIES/, "Migration review must use an explicit read capability policy.");
assert.match(context, /finance\.daily_sales\.history\.read_all/, "Historical sales reads must remain available during migration review.");
assert.match(context, /throw new ConflictException\("This company is active for migration review only/, "Migration review lock must report a workflow conflict, not a permission failure.");
assert.doesNotMatch(access, /rolePermission\.createMany/, "Listing available companies must not mutate role grants.");
assert.match(access, /membership\.role\.isSystem && membership\.role\.code === "BASEER_COMPANY_MANAGER"/, "System-manager capabilities must be resolved consistently in company listing and API authorization.");
assert.match(catalog, /catalog\(await this\.authorize\(authorization, companyId, "operations\.catalog\.read"\)/, "Catalog reads must require catalog-read, not catalog-manage.");
assert.match(execution, /workspace\(await this\.authorize\(authorization, companyId, "operations\.catalog\.read"\)/, "Execution workspace reads must require catalog-read, not catalog-manage.");
assert.match(execution, /workspaceSummary\(await this\.authorize\(authorization, companyId, "operations\.catalog\.read"\)/, "Execution summary reads must require catalog-read, not catalog-manage.");

console.log("Authorization consistency verification passed.");
