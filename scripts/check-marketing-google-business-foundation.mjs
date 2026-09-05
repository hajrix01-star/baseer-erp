import { readFileSync } from "node:fs";

const schema = readFileSync("apps/api/prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "apps/api/prisma/migrations/20260905150000_marketing_google_business_offline_foundation/migration.sql",
  "utf8",
);
const vault = readFileSync("apps/api/src/marketing/marketing-google-credential-vault.ts", "utf8");

function model(name) {
  const block = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)^\\}`, "m"))?.[1];
  if (!block) throw new Error(`Missing Prisma model: ${name}`);
  return block;
}

for (const table of [
  "MarketingProviderCredentialEnvelope",
  "MarketingGoogleBusinessLocationMapping",
  "MarketingProviderSyncRun",
]) {
  const block = model(table);
  for (const field of ["tenantId", "companyId"]) {
    if (!new RegExp(`^\\s*${field}\\s+String\\s+@db\\.Uuid\\s*$`, "m").test(block)) {
      throw new Error(`${table} must be tenant and company scoped.`);
    }
  }
  if (!migration.includes(`'${table}'`)) throw new Error(`${table} is absent from the RLS migration loop.`);
}

const connection = model("MarketingProviderConnection");
if (!connection.includes("@@unique([id, tenantId, companyId, provider])")) {
  throw new Error("Provider connection must expose a compound tenant/company/provider key for safe foreign keys.");
}

const envelope = model("MarketingProviderCredentialEnvelope");
for (const field of ["ciphertext", "iv", "tag", "keyVersion", "status"]) {
  if (!new RegExp(`^\\s*${field}\\s+`, "m").test(envelope)) throw new Error(`Credential envelope is missing ${field}.`);
}
if (!envelope.includes("@@unique([connectionId, tenantId, companyId, provider])")) {
  throw new Error("Credential envelope must have exactly one row per scoped provider connection.");
}
if (/refreshToken|accessToken|clientSecret/i.test(envelope)) {
  throw new Error("Credential envelope schema must not name or expose raw OAuth secret fields.");
}

const mapping = model("MarketingGoogleBusinessLocationMapping");
if (!/provider\s+MarketingProvider\s+@default\(GOOGLE_BUSINESS\)/.test(mapping)) {
  throw new Error("GBP mapping must default to GOOGLE_BUSINESS.");
}
if (!/@@unique\(\[id, tenantId, companyId, provider\](?:, map: "[^"]+")?\)/.test(mapping)) {
  throw new Error("GBP mapping must expose a provider-scoped key for sync receipts.");
}
if (!/selectedByMembership\s+CompanyMembership\s+@relation\(fields: \[tenantId, selectedByUserId, companyId\], references: \[tenantId, userId, companyId\]/.test(mapping)) {
  throw new Error("GBP mapping selection must be attributable to a membership in the selected company.");
}
if (!migration.includes('CONSTRAINT "MarketingGoogleBusinessLocationMapping_provider_check" CHECK ("provider" = \'GOOGLE_BUSINESS\')')) {
  throw new Error("GBP mapping must enforce the Google Business provider at SQL level.");
}
if (!migration.includes('"MarketingGoogleBusinessLocationMapping_selected_by_membership_fk"')) {
  throw new Error("GBP mapping migration must enforce the selecting company membership.");
}

const syncRun = model("MarketingProviderSyncRun");
if (!/fields: \[locationMappingId, tenantId, companyId, provider\], references: \[id, tenantId, companyId, provider\]/.test(syncRun)) {
  throw new Error("Sync receipts must inherit their provider from the selected GBP mapping.");
}
if (!migration.includes('FOREIGN KEY ("locationMappingId", "tenantId", "companyId", "provider") REFERENCES "MarketingGoogleBusinessLocationMapping"("id", "tenantId", "companyId", "provider")')) {
  throw new Error("Sync receipt migration must enforce provider-consistent GBP mapping references.");
}

for (const fragment of [
  "ENABLE ROW LEVEL SECURITY",
  "FORCE ROW LEVEL SECURITY",
  "current_setting(''app.tenant_id'', true)",
  "WITH CHECK",
]) {
  if (!migration.includes(fragment)) throw new Error(`Migration is missing RLS control: ${fragment}`);
}
if (/\bINSERT\s+INTO\b|\bUPDATE\s+"?MarketingProviderConnection"?/i.test(migration)) {
  throw new Error("Offline foundation migration must not create mappings, credentials, or connection state.");
}
if (!/aes-256-gcm/.test(vault) || !/baseer\.marketing-provider-credential\.v1/.test(vault)) {
  throw new Error("Credential vault must use the approved AEAD primitive and AAD namespace.");
}
if (/\b(fetch|axios|https?\.request|googleapis)\b/i.test(vault)) {
  throw new Error("Credential vault must not perform provider egress.");
}

console.log("Marketing Google Business offline foundation guard passed: scoped schema, credential sealing, GBP constraint, RLS, and no data activation.");
