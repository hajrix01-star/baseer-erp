#!/usr/bin/env sh
set -eu

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=baseer_app_user="$BASEER_APP_USER" \
  --set=baseer_app_database="$POSTGRES_DB" \
  --set=baseer_app_password="$BASEER_APP_PASSWORD" <<'EOSQL'
-- The role may already exist when an operator reuses an initialized cluster.
-- Keep creation idempotent, then enforce the restricted runtime attributes.
SELECT format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION PASSWORD %L',
  :'baseer_app_user',
  :'baseer_app_password'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'baseer_app_user'
)
\gexec

ALTER ROLE :"baseer_app_user"
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS
  NOREPLICATION
  PASSWORD :'baseer_app_password';
EOSQL
