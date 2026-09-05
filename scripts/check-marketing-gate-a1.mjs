import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migrationsPath = "apps/api/prisma/migrations";
const migrations = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8"))
  .join("\n");
const service = readFileSync("apps/api/src/marketing/marketing.service.ts", "utf8");
const controller = readFileSync("apps/api/src/marketing/marketing.controller.ts", "utf8");
const oauth = readFileSync("apps/api/src/marketing/marketing-google-oauth.service.ts", "utf8");
const workspace = readFileSync("apps/web/src/marketing-workspace-content.tsx", "utf8");

for (const table of ["MarketingCampaign", "MarketingReputationReplyPolicy"]) {
  const block = schema.match(new RegExp(`model ${table} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  if (!/^\s*tenantId\s+String\s+@db\.Uuid\s*$/m.test(block) || !/^\s*companyId\s+String\s+@db\.Uuid\s*$/m.test(block)) throw new Error(`${table} must be tenant and company scoped.`);
  for (const required of [
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY "${table}_tenant_isolation"`,
  ]) if (!migrations.includes(required)) throw new Error(`${table} is missing Gate A1 RLS control: ${required}`);
}
if (!/where: \{ tenantId: context\.tenantId, companyId: context\.companyId \}/.test(service)) throw new Error("Marketing workspace reads must use both trusted tenant and company context.");
if (!/where: \{ id: campaignId, tenantId: context\.tenantId, companyId: context\.companyId \}/.test(service)) throw new Error("Marketing campaign update must be company scoped.");
if (!/where: \{ id: request\.campaignId, tenantId: context\.tenantId, companyId: context\.companyId \}/.test(service)) throw new Error("Marketing campaign archive must be company scoped.");
if (!/IdempotencyService/.test(service) || !/auditEvent\.create/.test(service)) throw new Error("Marketing commands require idempotency and audit evidence.");
if (/\b(fetch|axios|https?\.request|googleapis)\b/i.test(`${service}\n${controller}\n${oauth}`)) throw new Error("Marketing Gate A1 must not include provider egress or provider SDK usage.");
if (!/Google authorization is not available in this Baseer release\./.test(controller) || /googleOAuth\.begin/.test(controller)) throw new Error("The marketing authorization route must remain hard-off and must not delegate to OAuth.");
if (!/Google authorization is not available in this Baseer release\./.test(oauth) || /accounts\.google\.com|authorizationConfiguration|encryptEphemeral/.test(oauth)) throw new Error("The OAuth service must remain hard-off without consent-url or credential-state behavior.");
if (!/NOT_CONNECTED/.test(service)) throw new Error("Marketing readiness must explicitly report NOT_CONNECTED rather than zero values.");
if (!/updateReputationReplyPolicy/.test(service) || !/marketing\.reputation\.reply_policy\.updated/.test(service)) throw new Error("Reply-policy configuration must be idempotent and audited.");
if (!/useBaseerForm/.test(workspace) || !/z\.object/.test(workspace) || !/data-baseer-rhf-form/.test(workspace)) throw new Error("Marketing campaign forms must use the Baseer RHF/Zod gateway.");
console.log("Marketing & Reputation Gate A1 guard passed: company scope, RLS, idempotency/audit, hard-off OAuth, no provider egress, honest readiness, central RHF/Zod forms.");
