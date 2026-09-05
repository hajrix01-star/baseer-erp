import { accessSync, constants, statSync } from "node:fs";
import { isIP } from "node:net";
import { isAbsolute, resolve, sep } from "node:path";

const allowedBindHosts = new Set(["127.0.0.1", "0.0.0.0"]);
const domainPattern =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function requireValue(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new Error(
      `${name} must be configured for private online deployment.`,
    );
  }
  return value.trim();
}

function requireBase64Key(name: string, value: string | undefined): void {
  const raw = requireValue(name, value);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64") !== raw) {
    throw new Error(`${name} must be a canonical base64-encoded 32-byte key.`);
  }
}

function requireHttpUrl(name: string, value: string | undefined): URL {
  const raw = requireValue(name, value);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return url;
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
}

function requireTrustedProxyAddresses(
  value: string | undefined,
): void {
  const addresses = requireValue("BASEER_TRUSTED_REVERSE_PROXY_IPS", value)
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (addresses.length === 0 || addresses.some((address) => isIP(address) === 0)) {
    throw new Error("BASEER_TRUSTED_REVERSE_PROXY_IPS must contain only explicit proxy IP addresses.");
  }
}

function requireWritableStorageDirectory(
  name: string,
  value: string | undefined,
  storageRoot: string,
): string {
  const configured = requireValue(name, value);
  if (!isAbsolute(configured)) {
    throw new Error(`${name} must be an absolute container path.`);
  }
  const directory = resolve(configured);
  if (!directory.startsWith(`${storageRoot}${sep}`)) {
    throw new Error(`${name} must be a dedicated directory below BASEER_FILE_STORAGE_ROOT.`);
  }
  try {
    if (!statSync(directory).isDirectory()) {
      throw new Error("not a directory");
    }
    accessSync(directory, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error(`${name} must exist and be readable and writable by the API runtime user.`);
  }
  return directory;
}

function validatePersistentFileStorage(environment: NodeJS.ProcessEnv, domain: string): void {
  if (environment.BASEER_FILE_STORAGE_ENABLED !== "true") {
    throw new Error("BASEER_FILE_STORAGE_ENABLED must be true for private online production.");
  }
  const configuredRoot = requireValue("BASEER_FILE_STORAGE_ROOT", environment.BASEER_FILE_STORAGE_ROOT);
  if (!isAbsolute(configuredRoot)) {
    throw new Error("BASEER_FILE_STORAGE_ROOT must be an absolute container path.");
  }
  const storageRoot = resolve(configuredRoot);
  try {
    if (!statSync(storageRoot).isDirectory()) throw new Error("not a directory");
    accessSync(storageRoot, constants.R_OK | constants.W_OK);
  } catch {
    throw new Error("BASEER_FILE_STORAGE_ROOT must be a mounted, readable, writable directory.");
  }

  requireWritableStorageDirectory(
    "BASEER_EMPLOYEE_DOCUMENT_STORAGE_ROOT",
    environment.BASEER_EMPLOYEE_DOCUMENT_STORAGE_ROOT,
    storageRoot,
  );
  requireWritableStorageDirectory(
    "BASEER_COMPANY_LOGO_STORAGE_ROOT",
    environment.BASEER_COMPANY_LOGO_STORAGE_ROOT,
    storageRoot,
  );
  requireBase64Key("BASEER_EMPLOYEE_DOCUMENT_ENCRYPTION_KEY", environment.BASEER_EMPLOYEE_DOCUMENT_ENCRYPTION_KEY);
  requireHttpUrl("BASEER_DOCUMENT_SCANNER_ENDPOINT", environment.BASEER_DOCUMENT_SCANNER_ENDPOINT);

  const waiStorageEnabled = environment.BASEER_WAI_ASSET_STORAGE_ENABLED ?? "false";
  if (waiStorageEnabled !== "true" && waiStorageEnabled !== "false") {
    throw new Error("BASEER_WAI_ASSET_STORAGE_ENABLED must be true or false.");
  }
  if (waiStorageEnabled === "true") {
    requireWritableStorageDirectory(
      "BASEER_WAI_ASSET_STORAGE_ROOT",
      environment.BASEER_WAI_ASSET_STORAGE_ROOT,
      storageRoot,
    );
    requireBase64Key("BASEER_WAI_ASSET_ENCRYPTION_KEY", environment.BASEER_WAI_ASSET_ENCRYPTION_KEY);
  }
  const waiBaileysPilotEnabled = environment.BASEER_WAI_BAILEYS_PILOT_ENABLED ?? "false";
  if (waiBaileysPilotEnabled !== "true" && waiBaileysPilotEnabled !== "false") {
    throw new Error("BASEER_WAI_BAILEYS_PILOT_ENABLED must be true or false.");
  }
  if (waiBaileysPilotEnabled === "true") {
    if (waiStorageEnabled !== "true") {
      throw new Error("BASEER_WAI_ASSET_STORAGE_ENABLED must be true before the Baileys pilot can start.");
    }
    requireBase64Key("BASEER_WAI_SESSION_ENCRYPTION_KEY", environment.BASEER_WAI_SESSION_ENCRYPTION_KEY);
  }

  if (environment.BASEER_GMAIL_OAUTH_ENABLED !== "true") return;

  requireWritableStorageDirectory(
    "BASEER_INBOUND_EVIDENCE_STORAGE_ROOT",
    environment.BASEER_INBOUND_EVIDENCE_STORAGE_ROOT,
    storageRoot,
  );
  requireBase64Key("BASEER_INBOUND_EVIDENCE_ENCRYPTION_KEY", environment.BASEER_INBOUND_EVIDENCE_ENCRYPTION_KEY);
  requireBase64Key("BASEER_INBOUND_EVIDENCE_STORAGE_ENCRYPTION_KEY", environment.BASEER_INBOUND_EVIDENCE_STORAGE_ENCRYPTION_KEY);
  const redirect = requireHttpUrl("BASEER_GMAIL_OAUTH_REDIRECT_URI", environment.BASEER_GMAIL_OAUTH_REDIRECT_URI);
  if (redirect.protocol !== "https:" || redirect.hostname !== domain.toLowerCase()) {
    throw new Error("BASEER_GMAIL_OAUTH_REDIRECT_URI must use the public HTTPS domain.");
  }
  requireValue("BASEER_GMAIL_OAUTH_CLIENT_ID", environment.BASEER_GMAIL_OAUTH_CLIENT_ID);
  requireValue("BASEER_GMAIL_OAUTH_CLIENT_SECRET", environment.BASEER_GMAIL_OAUTH_CLIENT_SECRET);
}

export function validatePrivateDeploymentConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const host = environment.BASEER_BIND_HOST ?? "127.0.0.1";
  if (!allowedBindHosts.has(host)) {
    throw new Error("BASEER_BIND_HOST must be 127.0.0.1 or 0.0.0.0.");
  }

  if (environment.NODE_ENV !== "production") {
    return;
  }

  if (environment.BASEER_DEPLOYMENT_MODE !== "private-online") {
    throw new Error("Production deployment mode must be private-online.");
  }
  if (host !== "0.0.0.0") {
    throw new Error(
      "Private online deployment must bind inside the Docker network.",
    );
  }
  requireTrustedProxyAddresses(environment.BASEER_TRUSTED_REVERSE_PROXY_IPS);
  if (environment.BASEER_ALLOW_PUBLIC_SIGNUP !== "false") {
    throw new Error("Public self-registration must remain disabled.");
  }

  const domain = requireValue(
    "BASEER_PUBLIC_DOMAIN",
    environment.BASEER_PUBLIC_DOMAIN,
  );
  if (!domainPattern.test(domain)) {
    throw new Error("BASEER_PUBLIC_DOMAIN must be a plain valid domain name.");
  }
  requireValue(
    "BASEER_BACKUP_TARGET_LABEL",
    environment.BASEER_BACKUP_TARGET_LABEL,
  );
  const systemTenantCode = requireValue(
    "BASEER_SYSTEM_TENANT_CODE",
    environment.BASEER_SYSTEM_TENANT_CODE,
  );
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(systemTenantCode)) {
    throw new Error("BASEER_SYSTEM_TENANT_CODE must be a safe tenant code.");
  }

  const jwtSecret = requireValue(
    "IDENTITY_JWT_SECRET",
    environment.IDENTITY_JWT_SECRET,
  );
  if (jwtSecret.length < 32) {
    throw new Error("IDENTITY_JWT_SECRET must be at least 32 characters long.");
  }

  for (const name of ["ATTENDANCE_PIN_PEPPER", "ATTENDANCE_QR_SECRET"]) {
    if (requireValue(name, environment[name]).length < 32) {
      throw new Error(`${name} must be at least 32 characters long.`);
    }
  }
  if (environment.BASEER_ATTENDANCE_LOCATION_RETENTION_SCHEDULER_ENABLED !== "true") {
    throw new Error("BASEER_ATTENDANCE_LOCATION_RETENTION_SCHEDULER_ENABLED must be true for private-online deployment.");
  }

  validatePersistentFileStorage(environment, domain);
}
