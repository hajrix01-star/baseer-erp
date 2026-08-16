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
}
