#!/usr/bin/env sh
set -eu

psql --set=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=baseer_app_user="$BASEER_TEST_DB_USER" \
  --set=baseer_app_database="$POSTGRES_DB" \
  --set=baseer_app_password="$BASEER_TEST_DB_PASSWORD" <<'EOSQL'
CREATE ROLE :"baseer_app_user"
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOBYPASSRLS
  PASSWORD :'baseer_app_password';

GRANT CONNECT ON DATABASE :"baseer_app_database" TO :"baseer_app_user";
GRANT USAGE ON SCHEMA public TO :"baseer_app_user";
EOSQL
