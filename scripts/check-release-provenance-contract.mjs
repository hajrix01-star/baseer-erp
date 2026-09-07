import { readFileSync } from "node:fs";
import { parseEnvironment, verifyPrivateOnlineReleasePreflight } from "./verify-private-online-release-preflight.mjs";

const compose = readFileSync("docker-compose.private-online.yml", "utf8");
const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
const environmentTemplate = readFileSync("ops/private-online/.env.private-online.example", "utf8");
const forcedCommand = readFileSync("ops/private-online/server/baseer-erp-deploy-ssh", "utf8");
const rootDeployer = readFileSync("ops/private-online/server/baseer-erp-deploy-release", "utf8");
const installer = readFileSync("ops/private-online/server/install-baseer-erp-deployer.sh", "utf8");

function serviceBlock(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9-]*:\\r?$|(?![\\s\\S]))`, "m"));
  if (!match) throw new Error(`Production compose is missing the ${name} service.`);
  return match[0];
}

function workflowJobBlock(name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9-]*:\\r?$|(?![\\s\\S]))`, "m"));
  if (!match) throw new Error(`Release workflow is missing the ${name} job.`);
  return match[0];
}

const requiredImages = {
  postgres: "BASEER_POSTGRES_IMAGE",
  migrate: "BASEER_MIGRATE_IMAGE",
  "grant-app-access": "BASEER_POSTGRES_IMAGE",
  api: "BASEER_API_IMAGE",
  web: "BASEER_WEB_IMAGE",
  caddy: "BASEER_CADDY_IMAGE",
};

for (const [service, variable] of Object.entries(requiredImages)) {
  const block = serviceBlock(service);
  if (!block.includes(`image: \${${variable}:?`)) {
    throw new Error(`${service} must receive its image through ${variable}.`);
  }
  if (service !== "postgres" && service !== "grant-app-access" && /^\s+build:/m.test(block)) {
    throw new Error(`${service} must not build the repository checkout in production compose.`);
  }
}

if (compose.includes("BASEER_RELEASE_TAG") || /image:\s+(?:baseer-erp-|postgres:|caddy:)/.test(compose)) {
  throw new Error("Production compose must not accept moving image tags.");
}

const caddyBlock = serviceBlock("caddy");
if (!caddyBlock.includes('"127.0.0.1:18080:80"') || /\n\s*-\s*"(?:80|443):/.test(caddyBlock)) {
  throw new Error("Production Caddy must use the existing private loopback listener, never claim public edge ports.");
}

const caddyfile = readFileSync("docker/Caddyfile.private-online", "utf8");
if (!caddyfile.includes("http://{$BASEER_PUBLIC_DOMAIN}")) {
  throw new Error("Private Caddy must not re-terminate shared-edge TLS or redirect the public domain.");
}

for (const variable of new Set(Object.values(requiredImages))) {
  const match = environmentTemplate.match(new RegExp(`^${variable}=([^\\r\\n]+)$`, "m"));
  if (!match || !/@sha256:[a-f0-9]{64}$/i.test(match[1])) {
    throw new Error(`${variable} must be documented as an immutable image@sha256 digest.`);
  }
}

for (const requiredWorkflowControl of [
  "packages: write",
  "attestations: write",
  "id-token: write",
  "docker/build-push-action@v6",
  "provenance: mode=max",
  "sbom: true",
  "actions/upload-artifact@v4",
  "baseer-release-manifest-",
  "@${{ needs.release-api.outputs.digest }}",
  "@${{ needs.release-migrate.outputs.digest }}",
  "@${{ needs.release-web.outputs.digest }}",
]) {
  if (!workflow.includes(requiredWorkflowControl)) {
    throw new Error(`Release workflow is missing required provenance control: ${requiredWorkflowControl}`);
  }
}

for (const requiredContinuousDeliveryControl of [
  "release-preflight:",
  "Require a successful pull-request merge gate",
  "listPullRequestsAssociatedWithCommit",
  "listWorkflowRuns",
  "needs: [release-preflight]",
  "deploy-private-online:",
  "needs: [release-manifest]",
  "name: production",
  "group: baseer-erp-private-online-production",
  "BASEER_DEPLOY_SSH_KEY",
  "BASEER_DEPLOY_HOST",
  "BASEER_DEPLOY_KNOWN_HOSTS",
  "deploy-release ${GITHUB_SHA}",
  ".baseer-release-images",
]) {
  if (!workflow.includes(requiredContinuousDeliveryControl)) {
    throw new Error(`Continuous deployment workflow is missing required control: ${requiredContinuousDeliveryControl}`);
  }
}

for (const name of ["quality", "web-acceptance"]) {
  if (!workflowJobBlock(name).includes("if: github.event_name == 'pull_request'")) {
    throw new Error(`Full ${name} must remain a pull-request merge gate.`);
  }
}

const browserGate = workflowJobBlock("web-acceptance");
for (const control of [
  "if: github.event_name == 'pull_request' && always()",
  "needs: [web-acceptance-shard]",
  "SHARD_RESULT: ${{ needs.web-acceptance-shard.result }}",
  'run: test "$SHARD_RESULT" = success',
]) {
  if (!browserGate.includes(control)) throw new Error(`Browser merge gate must fail closed: ${control}`);
}
const browserShard = workflowJobBlock("web-acceptance-shard");
for (const control of [
  "if: github.event_name == 'pull_request'",
  "fail-fast: false",
  "shard: [1, 2, 3]",
  "--shard=${{ matrix.shard }}/3",
  "baseer-erp-pr-web-shard-${{ github.event.pull_request.number || github.ref }}-${{ matrix.shard }}",
  "cancel-in-progress: true",
  "name: baseer-web-acceptance-${{ github.sha }}-${{ matrix.shard }}",
]) {
  if (!browserShard.includes(control)) throw new Error(`Browser shard coverage/evidence contract missing: ${control}`);
}
if (/continue-on-error:/.test(browserGate + browserShard)) {
  throw new Error("Browser acceptance must not ignore failures.");
}

for (const name of ["release-api", "release-migrate", "release-web"]) {
  if (!workflowJobBlock(name).includes("needs: [release-preflight]")) {
    throw new Error(`${name} must wait for the exact-main release preflight.`);
  }
}

if (!workflowJobBlock("release-preflight").includes("node scripts/check-release-provenance-contract.mjs")) {
  throw new Error("The main release preflight must verify the release provenance contract.");
}

if (!workflowJobBlock("release-preflight").includes("Refusing release: this main commit is not associated with a merged pull request.")) {
  throw new Error("The main release preflight must reject direct main pushes.");
}

if (!workflowJobBlock("deploy-private-online").includes("needs: [release-manifest]")) {
  throw new Error("Production deployment must wait for the immutable release manifest.");
}

if (!workflowJobBlock("quality").includes("cancel-in-progress: true")
  || !workflowJobBlock("web-acceptance").includes("cancel-in-progress: true")) {
  throw new Error("Superseded pull-request validations must be cancelled independently.");
}

if (!workflowJobBlock("quality").includes("baseer-erp-pr-quality-")
  || !workflowJobBlock("web-acceptance").includes("baseer-erp-pr-web-acceptance-")) {
  throw new Error("Quality and web acceptance need separate pull-request concurrency groups.");
}

for (const [name, cacheScope] of [
  ["release-api", "baseer-erp-api"],
  ["release-migrate", "baseer-erp-migrate"],
  ["release-web", "baseer-erp-web"],
]) {
  const job = workflowJobBlock(name);
  if (!job.includes(`cache-from: type=gha,scope=${cacheScope}`)
    || !job.includes(`cache-to: type=gha,mode=max,scope=${cacheScope}`)) {
    throw new Error(`${name} must use its isolated GitHub Actions build cache (${cacheScope}).`);
  }
}

if (/deploy-private-online:[\s\S]*?runs-on:\s+self-hosted/.test(workflow)) {
  throw new Error("Private-online deployment must not use a shared self-hosted runner.");
}

for (const [name, source, requiredControls] of [
  ["forced command", forcedCommand, ["SSH_ORIGINAL_COMMAND", "deploy-release", "baseer-erp-deploy-release"]],
  ["root deployer", rootDeployer, ["baseer-erp-private-online-api-1", "BASEER_API_IMAGE", "BASEER_MIGRATE_IMAGE", "BASEER_WEB_IMAGE", "--no-same-owner", "do not roll back automatically after migration"]],
  ["installer", installer, ["restrict,command=", "baseer-erp-deploy", "baseer-erp-deploy-release", "visudo -cf"]],
]) {
  for (const control of requiredControls) {
    if (!source.includes(control)) throw new Error(`Private-online ${name} is missing required control: ${control}`);
  }
}

if (!environmentTemplate.includes("BASEER_SYSTEM_TENANT_CODE=")) {
  throw new Error("The deployment environment template must satisfy the compose system tenant contract.");
}

const testDigest = (character) => `sha256:${character.repeat(64)}`;
const manifest = {
  schemaVersion: 1,
  source: { repository: "owner/baseer-erp", commit: "a".repeat(40) },
  images: {
    api: `ghcr.io/owner/baseer-erp-api@${testDigest("a")}`,
    migrate: `ghcr.io/owner/baseer-erp-migrate@${testDigest("b")}`,
    web: `ghcr.io/owner/baseer-erp-web@${testDigest("c")}`,
  },
};
const releaseEnvironment = parseEnvironment([
  `BASEER_API_IMAGE=${manifest.images.api}`,
  `BASEER_MIGRATE_IMAGE=${manifest.images.migrate}`,
  `BASEER_WEB_IMAGE=${manifest.images.web}`,
  `BASEER_POSTGRES_IMAGE=postgres@${testDigest("d")}`,
  `BASEER_CADDY_IMAGE=caddy@${testDigest("e")}`,
  "AI_CREDENTIAL_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
].join("\n"));

verifyPrivateOnlineReleasePreflight({ environment: releaseEnvironment, manifest });
for (const invalidEnvironment of [
  { ...releaseEnvironment, BASEER_API_IMAGE: "ghcr.io/owner/baseer-erp-api:main" },
  { ...releaseEnvironment, BASEER_WEB_IMAGE: `ghcr.io/owner/baseer-erp-web@${testDigest("f")}` },
]) {
  let rejected = false;
  try {
    verifyPrivateOnlineReleasePreflight({ environment: invalidEnvironment, manifest });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Release preflight must reject image tags and manifest mismatches.");
}

console.log("PASS: private-online release contract requires immutable digests, constrained continuous delivery, manifest matching, and an archived manifest.");
