import { readFileSync } from "node:fs";

const applicationImages = {
  BASEER_API_IMAGE: "api",
  BASEER_MIGRATE_IMAGE: "migrate",
  BASEER_WEB_IMAGE: "web",
};
// Third-party runtime images are also pinned and preflighted, even though
// they are intentionally not part of the Baseer CI release manifest.
const requiredImages = [...Object.keys(applicationImages), "BASEER_POSTGRES_IMAGE", "BASEER_CADDY_IMAGE", "BASEER_CLAMAV_IMAGE"];

function isCanonicalBase64Key(value) {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value;
}

export function parseEnvironment(text) {
  const values = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid environment entry: ${rawLine}`);

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (Object.hasOwn(values, key)) throw new Error(`Duplicate environment entry: ${key}`);
    values[key] = value;
  }

  return values;
}

function isImmutableDigestReference(value) {
  const match = /^(?<repository>[a-z0-9][a-z0-9._:/-]*)@sha256:(?<digest>[a-f0-9]{64})$/i.exec(value);
  if (!match || match.groups.repository.includes("//")) return false;

  // A registry may contain a port before its slash. A colon after the final
  // slash is an image tag and is forbidden even when a digest is also present.
  return !match.groups.repository.slice(match.groups.repository.lastIndexOf("/") + 1).includes(":");
}

export function verifyPrivateOnlineReleasePreflight({ environment, manifest }) {
  if (!manifest || typeof manifest !== "object" || manifest.schemaVersion !== 1) {
    throw new Error("Release manifest must be a schemaVersion 1 object.");
  }
  if (!/^[a-f0-9]{40}$/i.test(manifest.source?.commit ?? "")) {
    throw new Error("Release manifest must identify the immutable 40-character source commit.");
  }
  if (!manifest.images || typeof manifest.images !== "object") {
    throw new Error("Release manifest must contain application images.");
  }

  for (const variable of requiredImages) {
    const value = environment[variable];
    if (!isImmutableDigestReference(value ?? "")) {
      throw new Error(`${variable} must be an image@sha256:<64-hex-digest> reference with no tag.`);
    }
  }

  if (!isCanonicalBase64Key(environment.AI_CREDENTIAL_ENCRYPTION_KEY ?? "")) {
    throw new Error("AI_CREDENTIAL_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key.");
  }

  for (const [variable, manifestImage] of Object.entries(applicationImages)) {
    const expected = manifest.images[manifestImage];
    if (!isImmutableDigestReference(expected ?? "")) {
      throw new Error(`Release manifest image ${manifestImage} is not an immutable digest reference.`);
    }
    if (environment[variable] !== expected) {
      throw new Error(`${variable} must exactly match release manifest image ${manifestImage}.`);
    }
  }

  return {
    commit: manifest.source.commit,
    images: Object.fromEntries(requiredImages.map((variable) => [variable, environment[variable]])),
  };
}

function parseArguments(argumentsList) {
  const result = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!value || !["--env-file", "--manifest"].includes(flag) || result[flag]) {
      throw new Error("Usage: node scripts/verify-private-online-release-preflight.mjs --env-file <path> --manifest <path>");
    }
    result[flag] = value;
  }
  if (!result["--env-file"] || !result["--manifest"]) {
    throw new Error("Usage: node scripts/verify-private-online-release-preflight.mjs --env-file <path> --manifest <path>");
  }
  return result;
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/verify-private-online-release-preflight.mjs")) {
  try {
    const argumentsMap = parseArguments(process.argv.slice(2));
    const result = verifyPrivateOnlineReleasePreflight({
      environment: parseEnvironment(readFileSync(argumentsMap["--env-file"], "utf8")),
      manifest: JSON.parse(readFileSync(argumentsMap["--manifest"], "utf8")),
    });
    console.log(`PASS: private-online release preflight matched immutable images to commit ${result.commit}.`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
