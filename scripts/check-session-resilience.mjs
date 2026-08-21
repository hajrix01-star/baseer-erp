import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, login, importer, researcher, database, migration] = await Promise.all([
  read("apps/web/src/daily-sales-client.ts"),
  read("apps/web/src/baseer-login.tsx"),
  read("apps/api/src/decision-intelligence/decision-context-import.service.ts"),
  read("apps/api/src/decision-intelligence/decision-context-research.service.ts"),
  read("apps/api/src/database/database.service.ts"),
  read("apps/api/prisma/migrations/20260821260000_system_scheduler_lease/migration.sql"),
]);

assert.match(client, /refreshToken:\s*string/, "The browser session must include a refresh token.");
assert.match(client, /sessionExpiresAt:\s*string/, "The browser session must retain the refresh expiry.");
assert.match(client, /persistActiveSession/, "Only the central session writer may persist a sign-in session.");
assert.match(client, /refreshInFlight/, "Concurrent 401 responses must share one refresh request.");
assert.match(client, /\/auth\/refresh/, "Expired access tokens must use the server refresh endpoint.");
assert.match(client, /return await requestWithSession<T>\(refreshed, path, options\)/, "The original request must retry once after refresh.");
assert.match(client, /if \(error instanceof BaseerApiError && error\.status === 401\) \{\s*clearExpiredSession\(\)/, "Only an authentication rejection from refresh may clear the session.");
assert.doesNotMatch(client, /if \(error instanceof BaseerApiError && error\.status === 401\)\s*clearExpiredSession\(\);\s*throw error;/, "A normal 401 must not immediately log the user out.");
assert.match(login, /sessionSetupFailed/, "Login must distinguish workspace initialization from bad credentials.");
assert.match(importer, /BASEER_CONTEXT_IMPORT_ENABLED !== "true"/, "Context imports must remain opt-in.");
assert.match(researcher, /BASEER_CONTEXT_RESEARCH_ENABLED !== "true"/, "Context research must remain opt-in.");
assert.match(importer, /runScheduledImportsSafely/, "Import timer callbacks must catch failures.");
assert.match(researcher, /runScheduledResearchSafely/, "Research timer callbacks must catch failures.");
assert.match(database, /SystemSchedulerLease/, "Schedulers must use the durable lease, not a nested interactive transaction.");
assert.doesNotMatch(database, /pg_try_advisory_xact_lock/, "Transaction-scoped scheduler advisory locks must not return.");
assert.match(migration, /CREATE TABLE "SystemSchedulerLease"/, "The scheduler lease migration must be committed.");

console.log("Session and scheduler resilience policy verification passed.");
