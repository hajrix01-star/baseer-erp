import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const permissions = read("apps/api/src/administration/administration-permissions.ts");
const context = read("apps/api/src/company-context/company-context.service.ts");
const access = read("apps/api/src/company-context/company-access.service.ts");
const catalog = read("apps/api/src/operations/operations-catalog.controller.ts");
const execution = read("apps/api/src/operations/operations-execution.controller.ts");
const executionAuthorization = (method) => execution.match(new RegExp(`${method}\\(await this\\.authorize\\(authorization, companyId, (\\[[^\\]]+\\]|"[^"]+")\\)\\)`))?.[1] ?? "";

for (const capability of ["finance.categories.write", "finance.suppliers.write"]) {
  assert.match(permissions, new RegExp(`code: "${capability}"`), `${capability} must be assignable from the server permission catalogue.`);
}
assert.match(context, /MIGRATION_REVIEW_READ_CAPABILITIES/, "Migration review must use an explicit read capability policy.");
assert.match(context, /finance\.daily_sales\.history\.read_all/, "Historical sales reads must remain available during migration review.");
assert.match(context, /throw new ConflictException\("This company is active for migration review only/, "Migration review lock must report a workflow conflict, not a permission failure.");
assert.doesNotMatch(access, /rolePermission\.createMany/, "Listing available companies must not mutate role grants.");
assert.match(access, /membership\.role\.isSystem && membership\.role\.code === "BASEER_COMPANY_MANAGER"/, "System-manager capabilities must be resolved consistently in company listing and API authorization.");
assert.match(catalog, /catalog\(await this\.authorize\(authorization, companyId, "operations\.catalog\.read"\)/, "Catalog reads must require catalog-read, not catalog-manage.");
const workspaceAuthorization = executionAuthorization("workspace");
assert.match(workspaceAuthorization, /operations\.catalog\.read/, "Execution workspace reads must require catalog-read.");
assert.match(workspaceAuthorization, /operations\.recipe\.read/, "Execution workspace reads must require recipe-read.");
assert.match(workspaceAuthorization, /operations\.inventory\.read/, "Execution workspace reads must require inventory-read.");
assert.match(workspaceAuthorization, /operations\.purchase_request\.read/, "Execution workspace reads must require purchase-request-read.");
assert.match(workspaceAuthorization, /operations\.custody\.read/, "Execution workspace reads must require custody-read.");
assert.doesNotMatch(workspaceAuthorization, /operations\.catalog\.manage/, "Execution workspace reads must not require catalog-manage.");
const workspaceSummaryAuthorization = executionAuthorization("workspaceSummary");
for (const capability of ["operations.inventory.read", "operations.purchase_request.read", "operations.custody.read"]) {
  assert.match(workspaceSummaryAuthorization, new RegExp(capability.replaceAll(".", "\\.")), `Execution summary reads must require ${capability}.`);
}
assert.doesNotMatch(workspaceSummaryAuthorization, /operations\.catalog\.(?:read|manage)/, "Execution summary must not request catalog access it does not read.");

console.log("Authorization consistency verification passed.");
