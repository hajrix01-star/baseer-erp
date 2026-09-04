import { spawn } from "node:child_process";

const attempts = Number.parseInt(process.env.BASEER_NPM_AUDIT_ATTEMPTS ?? "3", 10);
const fetchTimeoutMs = Number.parseInt(process.env.BASEER_NPM_AUDIT_FETCH_TIMEOUT_MS ?? "45000", 10);
const retryDelayMs = 10_000;
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

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = await runAudit();
  if (result.code === 0) {
    console.log(`Runtime dependency audit passed on attempt ${attempt}/${attempts}.`);
    process.exit(0);
  }

  const shouldRetry = transientRegistryFailure.test(result.output);
  if (!shouldRetry || attempt === attempts) {
    console.error(`Runtime dependency audit failed on attempt ${attempt}/${attempts}.`);
    process.exit(result.code);
  }

  console.warn(`npm registry was temporarily unavailable; retrying runtime dependency audit (${attempt + 1}/${attempts}) in ${retryDelayMs / 1000}s.`);
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
}
