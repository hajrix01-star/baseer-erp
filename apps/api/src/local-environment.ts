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
  const profile = process.env.BASEER_LOCAL_ENV_PROFILE ?? 'test';
  if (profile !== 'test' && profile !== 'nurix-migration-staging') {
    throw new Error('BASEER_LOCAL_ENV_PROFILE must be test or nurix-migration-staging.');
  }
  const filename = profile === 'nurix-migration-staging' ? '.env.nurix-migration-staging' : '.env.baseer-test';
  const localEnvironmentPath = fileURLToPath(
    new URL(`../${filename}`, import.meta.url),
  );

  if (!existsSync(localEnvironmentPath)) return;

  dotenv.config({
    path: localEnvironmentPath,
    override: true,
    quiet: true,
  });
}
