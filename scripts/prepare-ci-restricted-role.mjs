import { Client } from "pg";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const admin = new Client({ connectionString: required("CI_DATABASE_ADMIN_URL") });
const password = required("CI_DATABASE_APP_PASSWORD");

await admin.connect();
try {
  await admin.query("BEGIN");
  await admin.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_ci_app') THEN CREATE ROLE baseer_ci_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;");
  await admin.query("ALTER ROLE baseer_ci_app PASSWORD $1", [password]);
  await admin.query("GRANT CONNECT ON DATABASE baseer_erp_test TO baseer_ci_app");
  await admin.query("GRANT USAGE ON SCHEMA public TO baseer_ci_app");
  await admin.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO baseer_ci_app");
  await admin.query("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO baseer_ci_app");
  await admin.query("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO baseer_ci_app");
  await admin.query("ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO baseer_ci_app");
  const role = await admin.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'baseer_ci_app'");
  if (role.rows.length !== 1 || role.rows[0].rolsuper || role.rows[0].rolbypassrls) throw new Error("CI application role must be a non-superuser without RLS bypass.");
  await admin.query("COMMIT");
  process.stdout.write("Restricted CI application role prepared.\n");
} catch (error) {
  await admin.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await admin.end();
}