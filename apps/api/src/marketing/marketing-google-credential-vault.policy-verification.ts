import assert from "node:assert/strict";

import { MarketingGoogleCredentialVault } from "./marketing-google-credential-vault.js";

const previous = process.env.BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY;
process.env.BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
try {
  const vault = new MarketingGoogleCredentialVault();
  const arz = { tenantId: "11111111-1111-4111-8111-111111111111", companyId: "22222222-2222-4222-8222-222222222222", provider: "GOOGLE_BUSINESS" as const };
  const shami = { ...arz, companyId: "33333333-3333-4333-8333-333333333333" };
  const envelope = vault.encrypt("verification-only-google-credential", arz);
  assert.equal(vault.decrypt(envelope, arz), "verification-only-google-credential");
  assert.throws(() => vault.decrypt(envelope, shami), /cannot be decrypted/i, "A credential envelope must not decrypt for another company.");
  assert.throws(() => vault.decrypt({ ...envelope, tag: Buffer.alloc(16, 0).toString("base64") }, arz), /cannot be decrypted/i, "A modified authentication tag must fail closed.");
  console.log(JSON.stringify({ ok: true, verified: ["google_credential_round_trip", "google_credential_company_aad_isolation", "google_credential_tamper_rejection"] }));
} finally {
  if (previous === undefined) delete process.env.BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.BASEER_PROVIDER_CREDENTIAL_ENCRYPTION_KEY = previous;
}
