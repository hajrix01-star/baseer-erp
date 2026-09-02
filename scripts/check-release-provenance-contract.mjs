import { readFileSync } from "node:fs";
import { parseEnvironment, verifyPrivateOnlineReleasePreflight } from "./verify-private-online-release-preflight.mjs";

const compose = readFileSync("docker-compose.private-online.yml", "utf8");
const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
const environmentTemplate = readFileSync("ops/private-online/.env.private-online.example", "utf8");

function serviceBlock(name) {
  const match = compose.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [A-Za-z][A-Za-z0-9-]*:|\\Z)`, "m"));
  if (!match) throw new Error(`Production compose is missing the ${name} service.`);
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

console.log("PASS: private-online release contract requires immutable digests, OCI attestations, manifest matching, and an archived manifest.");
