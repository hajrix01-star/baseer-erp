\getenv baseer_app_user BASEER_APP_USER
\getenv baseer_app_database POSTGRES_DB

-- This script runs once during database initialization and again in the
-- private-online grant-app-access job after every successful migration.
-- The runtime principal must remain dedicated: do not repair ownership or
-- memberships automatically on an existing database.
SELECT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'baseer_app_user'
) AS baseer_app_role_exists
\gset
\if :baseer_app_role_exists
\else
\echo 'ERROR: BASEER_APP_USER does not exist. Initialize the database first.'
\quit 3
\endif

SELECT oid AS baseer_app_role_oid
FROM pg_roles
WHERE rolname = :'baseer_app_user'
\gset

SELECT CASE WHEN
  EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = :baseer_app_role_oid)
  OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = :baseer_app_role_oid)
  OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = :baseer_app_role_oid)
  OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = :baseer_app_role_oid)
  OR EXISTS (SELECT 1 FROM pg_type WHERE typowner = :baseer_app_role_oid)
  OR EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole = :baseer_app_role_oid)
  OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = :baseer_app_role_oid)
THEN 'true' ELSE 'false' END AS baseer_app_has_ownership_or_membership
\gset
\if :baseer_app_has_ownership_or_membership
\echo 'ERROR: BASEER_APP_USER owns database objects or belongs to another role. Resolve that manually before applying runtime grants.'
\quit 3
\endif

ALTER ROLE :"baseer_app_user"
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS
  NOREPLICATION;

REVOKE ALL PRIVILEGES ON DATABASE :"baseer_app_database" FROM :"baseer_app_user";
GRANT CONNECT ON DATABASE :"baseer_app_database" TO :"baseer_app_user";

-- PostgreSQL can give CREATE on public through PUBLIC. Remove that shared
-- grant; postgres remains the owner and can still run migrations.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM :"baseer_app_user";
GRANT USAGE ON SCHEMA public TO :"baseer_app_user";

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM :"baseer_app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"baseer_app_user";

REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM :"baseer_app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO :"baseer_app_user";

-- The private-online migrate job connects as postgres. Replace any old
-- defaults granted by that owner before granting the limited replacement.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON TABLES FROM :"baseer_app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"baseer_app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE ALL ON SEQUENCES FROM :"baseer_app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"baseer_app_user";

-- Migrations create AuditEvent after initialization. This post-migrate pass
-- must therefore remove update/delete explicitly after every migrate job.
SELECT format(
  'REVOKE UPDATE, DELETE ON TABLE public.%I FROM %I',
  'AuditEvent',
  :'baseer_app_user'
)
WHERE to_regclass('public."AuditEvent"') IS NOT NULL
\gexec
