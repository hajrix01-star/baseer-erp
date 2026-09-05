import { readFile } from "node:fs/promises";

const files = {
  schema: "apps/api/prisma/schema.prisma",
  migration: "apps/api/prisma/migrations/20260905170000_marketing_google_business_oauth_pilot/migration.sql",
  controller: "apps/api/src/marketing/marketing.controller.ts",
  pilot: "apps/api/src/marketing/marketing-google-business-oauth-pilot.service.ts",
  generic: "apps/api/src/marketing/marketing-google-oauth.service.ts",
};
const text = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")])));
const requireText = (value, expectation) => { if (!value.includes(expectation)) throw new Error(`MKT-02A guard: missing ${expectation}`); };

requireText(text.generic, 'throw new ForbiddenException("Google authorization is not available in this Baseer release.")');
requireText(text.controller, '@Post("provider-connections/google-business/pilot/authorization")');
requireText(text.controller, '@Get("provider-connections/google-business/pilot/callback")');
requireText(text.pilot, "this.requirePilotCompany(context.companyId);");
if (text.pilot.indexOf("this.requirePilotCompany(context.companyId);") > text.pilot.indexOf("googleBusinessPilotConfiguration")) throw new Error("MKT-02A guard: pilot allowlist must precede configuration.");
requireText(text.pilot, "randomBytes(32).toString(\"base64url\")");
requireText(text.pilot, 'code_challenge_method: "S256"');
requireText(text.pilot, 'https://oauth2.googleapis.com/token');
requireText(text.pilot, "AbortSignal.timeout(12_000)");
requireText(text.pilot, "const updated = await tx.marketingGoogleBusinessOAuthState.updateMany");
requireText(text.pilot, "consumedAt: null, expiresAt: { gt: now }");
requireText(text.pilot, "this.requirePilotCompany(claimed.companyId);");
requireText(text.pilot, "this.platform.googleBusinessPilotConfiguration();");
requireText(text.pilot, 'status: "AUTHORIZED_AWAITING_SELECTION"');
requireText(text.pilot, 'data: { status: "REVOKED", revokedAt: new Date() }');
requireText(text.schema, "model MarketingGoogleBusinessOAuthState");
requireText(text.migration, 'CHECK ("provider" = \'GOOGLE_BUSINESS\')');
requireText(text.migration, 'FOREIGN KEY ("tenantId", "initiatedByUserId", "companyId")');
requireText(text.migration, 'FORCE ROW LEVEL SECURITY');
requireText(text.migration, 'WHERE "consumedAt" IS NULL');

console.log("Marketing Google Business OAuth pilot guard passed: separate hard-off boundary, fail-closed allowlist, PKCE/state, atomic callback claim, constrained storage, and no unbounded egress.");
