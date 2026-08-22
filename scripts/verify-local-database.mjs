import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const environmentFile = resolve(
  process.env.BASEER_ENV_FILE ?? 'apps/api/.env.baseer-test',
);

if (!existsSync(environmentFile)) {
  throw new Error(`Canonical local environment file was not found: ${environmentFile}`);
}

dotenv.config({ path: environmentFile, override: true, quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in the canonical local environment.');
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const expected = {
  host: '127.0.0.1',
  port: '5433',
  database: 'baseer_erp_test',
};
const actual = {
  host: databaseUrl.hostname,
  port: databaseUrl.port || '5432',
  database: databaseUrl.pathname.replace(/^\//, ''),
};

for (const key of Object.keys(expected)) {
  if (actual[key] !== expected[key]) {
    throw new Error(
      `Refusing to use a non-canonical local database: expected ${expected.host}:${expected.port}/${expected.database}, received ${actual.host}:${actual.port}/${actual.database}.`,
    );
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(
    'SELECT current_database() AS database_name, inet_server_addr()::text AS host, inet_server_port() AS port',
  );
  const connected = result.rows[0];

  if (
    connected.database_name !== expected.database ||
    String(connected.port) !== '5432'
  ) {
    throw new Error('The local database connection did not match the expected Baseer-ERP database.');
  }

  console.log(
    JSON.stringify({
      status: 'verified',
      environmentFile: relative(process.cwd(), environmentFile),
      database: connected.database_name,
      endpoint: `${actual.host}:${actual.port}`,
    }),
  );
} finally {
  await pool.end();
}
