import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const attempts = Number.parseInt(process.env.BASEER_NPM_AUDIT_ATTEMPTS ?? "3", 10);
const fetchTimeoutMs = Number.parseInt(process.env.BASEER_NPM_AUDIT_FETCH_TIMEOUT_MS ?? "45000", 10);
const retryDelayMs = 10_000;
const osvTimeoutMs = 45_000;
const osvBatchSize = 1_000;
const patchedXlsxCdnRelease = {
  version: "0.20.3",
  resolved: "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
  integrity: "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==",
  advisoryIds: new Set(["GHSA-4r6h-8v6p-xvw6", "GHSA-5pgg-2g8v-p4x9"]),
};
const auditArguments = [
  "audit",
  "--omit=dev",
  "--omit=optional",
  "--fetch-retries=0",
  `--fetch-timeout=${fetchTimeoutMs}`,
];
const auditCommand = process.platform === "win32"
  ? { executable: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `npm ${auditArguments.join(" ")}`] }
  : { executable: "npm", args: auditArguments };
const transientRegistryFailure = /\b(?:429|5\d\d)\b|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|audit endpoint returned an error/i;

if (!Number.isInteger(attempts) || attempts < 1) {
  throw new Error("BASEER_NPM_AUDIT_ATTEMPTS must be a positive integer.");
}
if (!Number.isInteger(fetchTimeoutMs) || fetchTimeoutMs < 1) {
  throw new Error("BASEER_NPM_AUDIT_FETCH_TIMEOUT_MS must be a positive integer.");
}

function runAudit() {
  return new Promise((resolve, reject) => {
    const child = spawn(auditCommand.executable, auditCommand.args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function runtimePackagesFromLockfile(lockfile) {
  if (lockfile.lockfileVersion < 2 || !lockfile.packages || typeof lockfile.packages !== "object") {
    throw new Error("package-lock.json must provide a packages graph for the OSV fallback audit.");
  }

  const packages = new Map();
  for (const [path, metadata] of Object.entries(lockfile.packages)) {
    if (!path.includes("node_modules/") || !metadata?.version || metadata.link || metadata.dev || metadata.optional || metadata.devOptional) {
      continue;
    }

    const nodeModulesIndex = path.lastIndexOf("node_modules/");
    const packagePath = path.slice(nodeModulesIndex + "node_modules/".length);
    const name = packagePath.startsWith("@")
      ? packagePath.split("/").slice(0, 2).join("/")
      : packagePath.split("/")[0];
    if (name) {
      packages.set(`${name}@${metadata.version}`, {
        name,
        version: metadata.version,
        resolved: metadata.resolved,
        integrity: metadata.integrity,
      });
    }
  }

  if (packages.size === 0) {
    throw new Error("No deployable runtime packages were found in package-lock.json.");
  }
  return [...packages.values()];
}

function documentedPatchedXlsxFinding(packageReference, vulnerability) {
  return packageReference.name === "xlsx"
    && packageReference.version === patchedXlsxCdnRelease.version
    && packageReference.resolved === patchedXlsxCdnRelease.resolved
    && packageReference.integrity === patchedXlsxCdnRelease.integrity
    && patchedXlsxCdnRelease.advisoryIds.has(vulnerability.id);
}

async function fetchOsvBatch(packages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), osvTimeoutMs);
  try {
    const response = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        queries: packages.map(({ name, version }) => ({ package: { name, ecosystem: "npm" }, version })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OSV returned HTTP ${response.status}.`);
    }
    const body = await response.json();
    if (!Array.isArray(body.results) || body.results.length !== packages.length) {
      throw new Error("OSV returned an incomplete runtime dependency audit response.");
    }
    return body.results;
  } finally {
    clearTimeout(timeout);
  }
}

async function runOsvFallbackAudit() {
  const lockfile = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  const packages = runtimePackagesFromLockfile(lockfile);
  const findings = [];

  console.warn(`npm registry remained unavailable; auditing ${packages.length} deployable packages through the independent OSV advisory source.`);
  for (let start = 0; start < packages.length; start += osvBatchSize) {
    const batch = packages.slice(start, start + osvBatchSize);
    const results = await fetchOsvBatch(batch);
    for (let index = 0; index < results.length; index += 1) {
      for (const vulnerability of results[index].vulns ?? []) {
        if (!documentedPatchedXlsxFinding(batch[index], vulnerability)) {
          findings.push(`${batch[index].name}@${batch[index].version} (${vulnerability.id})`);
        }
      }
    }
  }

  if (findings.length > 0) {
    throw new Error(`OSV found deployable dependency vulnerabilities: ${findings.slice(0, 25).join(", ")}${findings.length > 25 ? ` (+${findings.length - 25} more)` : ""}.`);
  }
  console.log("Runtime dependency audit passed through the independent OSV fallback.");
}

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = await runAudit();
  if (result.code === 0) {
    console.log(`Runtime dependency audit passed on attempt ${attempt}/${attempts}.`);
    process.exit(0);
  }

  const shouldRetry = transientRegistryFailure.test(result.output);
  if (!shouldRetry) {
    console.error(`Runtime dependency audit failed on attempt ${attempt}/${attempts}.`);
    process.exit(result.code);
  }

  if (attempt < attempts) {
    console.warn(`npm registry was temporarily unavailable; retrying runtime dependency audit (${attempt + 1}/${attempts}) in ${retryDelayMs / 1000}s.`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

try {
  await runOsvFallbackAudit();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
