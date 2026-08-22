import 'dotenv/config';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const projectDirectory = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  schema: join(projectDirectory, 'prisma/schema.prisma'),
  migrations: { path: join(projectDirectory, 'prisma/migrations') },
  datasource: { url: env('DATABASE_URL') },
});
