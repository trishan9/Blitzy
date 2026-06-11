#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
gen()  { node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"; }
lock() { chmod 600 "$1" 2>/dev/null || true; }
ensure_env() {
  local key="$1" value="$2"
  if ! grep -qE "^${key}=" .env; then
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

say "Credentials (./.env)"
if [ -s .env ]; then
  echo "    exists — reusing (delete ./.env and re-run to rotate everything)"
else
  cat > .env <<EOF
POSTGRES_PASSWORD=$(gen)
APP_RW_PW=$(gen)
APP_RO_PW=$(gen)
MIGRATOR_PW=$(gen)
REDIS_PW=$(gen)
GRAFANA_PW=$(gen)
WAZUH_DASHBOARD_PASSWORD=$(gen)
WAZUH_API_PASSWORD=$(gen)
WAZUH_ADMIN_USER=wazuh
WAZUH_ADMIN_PASSWORD=wazuh
EOF
  echo "    created with fresh random credentials"
fi
ensure_env WAZUH_DASHBOARD_PASSWORD "$(gen)"
ensure_env WAZUH_API_PASSWORD "$(gen)"
ensure_env WAZUH_ADMIN_USER wazuh
ensure_env WAZUH_ADMIN_PASSWORD wazuh
lock .env

set -a; . ./.env; set +a

say "Starting postgres + redis + mongo"
docker compose up -d postgres redis mongo

printf '    waiting for postgres'
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U postgres -d ecommerce >/dev/null 2>&1; then
    printf ' ready\n'; break
  fi
  printf '.'; sleep 2
done

say "Aligning database roles"
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -h 127.0.0.1 -U postgres -d ecommerce -q \
  -c "DO \$\$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_rw')   THEN CREATE ROLE app_rw   LOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_ro')   THEN CREATE ROLE app_ro   LOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='migrator') THEN CREATE ROLE migrator LOGIN; END IF;
      END \$\$;" \
  -c "ALTER ROLE app_rw   PASSWORD '$APP_RW_PW'  NOSUPERUSER NOCREATEDB NOCREATEROLE;" \
  -c "ALTER ROLE app_ro   PASSWORD '$APP_RO_PW'  NOSUPERUSER NOCREATEDB NOCREATEROLE;" \
  -c "ALTER ROLE migrator PASSWORD '$MIGRATOR_PW' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;" >/dev/null
echo "    app_rw / app_ro / migrator aligned"

if ! docker compose exec -T redis sh -c "redis-cli -a '$REDIS_PW' ping" 2>/dev/null | grep -q PONG; then
  echo "    redis credential changed — recreating container"
  docker compose up -d --force-recreate redis >/dev/null
  sleep 3
fi

say "Applying roles, schema and RLS"
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -h 127.0.0.1 -U postgres -d ecommerce -q -v ON_ERROR_STOP=1 \
  -v rw_pw="$APP_RW_PW" -v ro_pw="$APP_RO_PW" -v mig_pw="$MIGRATOR_PW" \
  < infra/postgres/db-setup.sql >/dev/null
echo "    roles + grants ok"

for f in backend/src/db/migrations/*.sql; do
  if docker compose exec -T -e PGPASSWORD="$MIGRATOR_PW" postgres \
       psql -h 127.0.0.1 -U migrator -d ecommerce -q -v ON_ERROR_STOP=1 < "$f" >/dev/null 2>&1; then
    echo "    applied $(basename "$f")"
  else
    echo "    skipped $(basename "$f") (already applied)"
  fi
done

say "Writing backend/.env"
cat > backend/.env <<EOF
NODE_ENV=development
PORT=8000
APP_URL=http://localhost:8000
FRONTEND_ORIGIN=http://localhost:5173
TRUST_PROXY_HOPS=1

DATABASE_URL=postgres://app_rw:${APP_RW_PW}@127.0.0.1:55433/ecommerce
MIGRATOR_DATABASE_URL=postgres://migrator:${MIGRATOR_PW}@127.0.0.1:55433/ecommerce
REDIS_URL=redis://:${REDIS_PW}@127.0.0.1:56379
MONGO_URI=mongodb://127.0.0.1:57017/activity_log

BETTER_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64'))")
BETTER_AUTH_URL=http://localhost:8000
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:5173
PASSKEY_RP_ID=localhost

JWT_ISS=http://localhost:8000
JWT_AUD=ecommerce-api

CRYPTO_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
CRYPTO_KEY_VERSION=1
BLIND_INDEX_PEPPER=$(gen)
GUEST_CART_SECRET=$(gen)

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

SSRF_ALLOWED_HOSTS=
DEMO_MODE=false
EOF
lock backend/.env
echo "    written"

say "Done"
cat <<'EOF'
    cd backend && npm install && npm run dev
    cd client  && npm install && npm run dev

    npm run verify --prefix backend
    npm run verify:live --prefix backend
    npm run demo:pairs --prefix backend
EOF
