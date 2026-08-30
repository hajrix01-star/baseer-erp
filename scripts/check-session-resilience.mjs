import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [client, login, importer, researcher, database, migration, errorPresenter, main] = await Promise.all([
  read("apps/web/src/daily-sales-client.ts"),
  read("apps/web/src/baseer-login.tsx"),
  read("apps/api/src/decision-intelligence/decision-context-import.service.ts"),
  read("apps/api/src/decision-intelligence/decision-context-research.service.ts"),
  read("apps/api/src/database/database.service.ts"),
  read("apps/api/prisma/migrations/20260821260000_system_scheduler_lease/migration.sql"),
  read("apps/web/src/baseer-api-error.ts"),
  read("apps/api/src/main.ts"),
]);

assert.match(client, /refreshToken:\s*string/, "The browser session must include a refresh token.");
assert.match(client, /sessionExpiresAt:\s*string/, "The browser session must retain the refresh expiry.");
assert.match(client, /persistActiveSession/, "Only the central session writer may persist a sign-in session.");
assert.match(client, /refreshInFlight/, "Concurrent 401 responses must share one refresh request.");
assert.match(client, /\/auth\/refresh/, "Expired access tokens must use the server refresh endpoint.");
assert.match(client, /for \(let refreshAttempt = 0; refreshAttempt < 2; refreshAttempt \+= 1\)/, "The original request must retry once after a successful refresh, with a bounded recovery loop.");
assert.match(client, /return await requestWithTransientReadRetry<T>\(current, path, options\)/, "Each recovery attempt must use the current authenticated session.");
assert.match(client, /const refreshed = await refreshSessionOnce\(current\.accessToken\);\s*if \(!refreshed\) throw error;\s*current = refreshed;/, "A successful refresh must replace the session used by the retried request.");
assert.match(client, /if \(error instanceof BaseerApiError && error\.status === 401\) \{\s*clearExpiredSession\(\)/, "Only an authentication rejection from refresh may clear the session.");
assert.doesNotMatch(client, /if \(error instanceof BaseerApiError && error\.status === 401\)\s*clearExpiredSession\(\);\s*throw error;/, "A normal 401 must not immediately log the user out.");
assert.match(client, /requestWithTransientReadRetry/, "Safe GET reads must retry a transient transport failure once.");
assert.match(client, /\(options\?\.method \?\? "GET"\)\.toUpperCase\(\) !== "GET"/, "Automatic retries must be limited to GET reads.");
assert.match(errorPresenter, /presentBaseerLoadError/, "Read failures must use dedicated failure copy, not loading copy.");
assert.match(main, /await database\.client\.\$connect\(\)/, "The API must connect to PostgreSQL before listening.");
assert.match(main, /await database\.client\.\$queryRaw`SELECT 1`/, "The API must verify PostgreSQL before listening.");
assert.match(login, /sessionSetupFailed/, "Login must distinguish workspace initialization from bad credentials.");
assert.match(importer, /BASEER_CONTEXT_IMPORT_ENABLED !== "true"/, "Context imports must remain opt-in.");
assert.match(researcher, /BASEER_CONTEXT_RESEARCH_ENABLED !== "true"/, "Context research must remain opt-in.");
assert.match(importer, /runScheduledImportsSafely/, "Import timer callbacks must catch failures.");
assert.match(researcher, /runScheduledResearchSafely/, "Research timer callbacks must catch failures.");
assert.match(database, /SystemSchedulerLease/, "Schedulers must use the durable lease, not a nested interactive transaction.");
assert.doesNotMatch(database, /pg_try_advisory_xact_lock/, "Transaction-scoped scheduler advisory locks must not return.");
assert.match(migration, /CREATE TABLE "SystemSchedulerLease"/, "The scheduler lease migration must be committed.");

async function listWebSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listWebSources(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

const webSources = await listWebSources(fileURLToPath(new URL("../apps/web/src", import.meta.url)));
for (const source of webSources) {
  const contents = await readFile(source, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line.includes("presentBaseerApiError(")) continue;
    assert.doesNotMatch(
      line,
      /(?:\b(?:text|t)\.loading\w*|["']تحميل\b|["']Loading\b)/,
      `${source} must not use loading copy as an error fallback.`,
    );
  }
}

console.log("Session and scheduler resilience policy verification passed.");
