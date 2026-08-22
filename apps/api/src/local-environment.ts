import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the single, canonical local Baseer-ERP environment when it exists.
 *
 * The file is deliberately resolved relative to this package rather than to
 * the current working directory. That prevents a shell started from another
 * repository from silently pointing the API at its DATABASE_URL. Production
 * images do not contain this local-only file and continue to use their
 * injected deployment environment.
 */
export function loadCanonicalLocalEnvironment(): void {
  const localEnvironmentPath = fileURLToPath(
    new URL('../.env.baseer-test', import.meta.url),
  );

  if (!existsSync(localEnvironmentPath)) return;

  dotenv.config({
    path: localEnvironmentPath,
    override: true,
    quiet: true,
  });
}
