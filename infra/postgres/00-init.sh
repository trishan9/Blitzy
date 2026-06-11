#!/bin/bash
set -euo pipefail

read_secret() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "FATAL: required secret $file is missing" >&2
    exit 1
  fi
  tr -d '\r\n' < "$file"
}

RW_PW="$(read_secret /run/secrets/app_rw_pw)"
RO_PW="$(read_secret /run/secrets/app_ro_pw)"
MIG_PW="$(read_secret /run/secrets/migrator_pw)"

echo "[init] creating least-privilege roles + revoking PUBLIC on schema public"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v rw_pw="$RW_PW" -v ro_pw="$RO_PW" -v mig_pw="$MIG_PW" \
  -f /docker-entrypoint-initdb.d/db-setup.sql

echo "[init] roles created:"
psql -tA --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "SELECT rolname||' bypassrls='||rolbypassrls FROM pg_roles WHERE rolname IN ('app_rw','app_ro','migrator') ORDER BY rolname;"
