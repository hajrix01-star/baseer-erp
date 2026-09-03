import { createRequire } from 'node:module';

// Root scripts exercise the API but do not own its runtime dependencies.
// Resolve from the API workspace so a clean npm install behaves identically
// whether npm hoists a package to the repository root or not.
const requireApiWorkspace = createRequire(new URL('../apps/api/package.json', import.meta.url));

export const { FastifyAdapter } = requireApiWorkspace('@nestjs/platform-fastify');
