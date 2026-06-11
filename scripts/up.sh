#!/usr/bin/env bash
set -u

MODE="${1:-up}"
COMPOSE="docker compose --profile app --profile detection"

g() { printf '\033[32m%s\033[0m' "$1"; }
r() { printf '\033[31m%s\033[0m' "$1"; }
y() { printf '\033[33m%s\033[0m' "$1"; }
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

envval() {
  grep -E "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '"'"'"'\r'
}

GRAFANA_PW="$(envval GRAFANA_PW)"
WAZUH_API_PASSWORD="$(envval WAZUH_API_PASSWORD)"
WAZUH_ADMIN_USER="$(envval WAZUH_ADMIN_USER)"
WAZUH_ADMIN_PASSWORD="$(envval WAZUH_ADMIN_PASSWORD)"

code() {
  local u="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" "$u" 2>/dev/null || echo 000
}

wait_for() {
  local label="$1" url="$2" tries="$3"; shift 3
  local i c
  for i in $(seq 1 "$tries"); do
    c="$(code "$url" "$@")"
    case "$c" in 2*|3*) return 0;; esac
    printf '.' ; sleep 5
  done
  return 1
}

if [ "$MODE" != "check" ]; then
  say "Starting containers"
  $COMPOSE up -d 2>&1 | grep -vE "^ (Container|Network|Volume).*(Running|Exists)$" || true

  say "Waiting for the slow ones"
  printf '  api    '; wait_for api    "http://localhost:8080/health"        24 && printf ' %s\n' "$(g ok)" || printf ' %s\n' "$(r timeout)"
  printf '  wazuh  '; wait_for wazuh  "http://127.0.0.1:5601/api/status"    36 && printf ' %s\n' "$(g ok)" || printf ' %s\n' "$(r timeout)"
  printf '  graf   '; wait_for graf   "http://127.0.0.1:3000/api/health"    24 && printf ' %s\n' "$(g ok)" || printf ' %s\n' "$(r timeout)"

  if [ -z "$WAZUH_API_PASSWORD" ] || [ -z "$WAZUH_ADMIN_USER" ] || [ -z "$WAZUH_ADMIN_PASSWORD" ]; then
    say "Wazuh credentials are missing"
    printf '  Run bash scripts/setup.sh to add WAZUH_* values to .env\n'
  elif [ "$($COMPOSE exec -T -e WAZUH_API_PASSWORD="$WAZUH_API_PASSWORD" wazuh-dashboard sh -c 'curl -sk -u "wazuh-wui:${WAZUH_API_PASSWORD}" -X POST https://wazuh:55000/security/user/authenticate -o /dev/null -w "%{http_code}"' 2>/dev/null)" != "200" ]; then
    say "Repairing the Wazuh API password"
    $COMPOSE exec -T \
      -e WAZUH_ADMIN_USER="$WAZUH_ADMIN_USER" \
      -e WAZUH_ADMIN_PASSWORD="$WAZUH_ADMIN_PASSWORD" \
      -e WAZUH_API_PASSWORD="$WAZUH_API_PASSWORD" \
      wazuh sh -c '
      T=$(curl -sk -u "${WAZUH_ADMIN_USER}:${WAZUH_ADMIN_PASSWORD}" -X POST https://localhost:55000/security/user/authenticate \
        | sed -n "s/.*\"token\": *\"\([^\"]*\)\".*/\1/p")
      curl -sk -X PUT "https://localhost:55000/security/users/2" \
        -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
        -d "{\"password\":\"${WAZUH_API_PASSWORD}\"}" -o /dev/null -w "  set -> %{http_code}\n"
    ' 2>/dev/null
  fi

  if [ "$(code "http://127.0.0.1:5601/api/saved_objects/dashboard/blitzy-security-dashboard" -H 'osd-xsrf: true')" != "200" ]; then
    say "Importing the Wazuh dashboard"
    curl -s -X POST "http://127.0.0.1:5601/api/saved_objects/_import?overwrite=true" \
      -H "osd-xsrf: true" -F "file=@infra/detection/wazuh/blitzy-dashboard.ndjson" \
      | grep -o '"successCount":[0-9]*' | sed 's/^/  /'
  fi
fi

say "Containers"
EXPECTED="api grafana loki mongo nginx postgres prometheus promtail redis suricata wazuh wazuh-dashboard wazuh-indexer"
RUNNING="$($COMPOSE ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk '$2=="running"{print $1}')"
n=0
for svc in $EXPECTED; do
  if printf '%s\n' "$RUNNING" | grep -qx "$svc"; then n=$((n+1)); else printf '  %-18s %s\n' "$svc" "$(r DOWN)"; fi
done
printf '  %d of 13 running\n' "$n"

say "Ports and addresses"
printf '  %-26s %-8s %-46s %s\n' "WHAT" "PORT" "ADDRESS" "STATUS"

row() {
  local what="$1" port="$2" url="$3"; shift 3
  local c; c="$(code "$url" "$@")"
  local s; case "$c" in 2*|3*) s="$(g "$c")";; 000) s="$(r "$c")";; *) s="$(y "$c")";; esac
  printf '  %-26s %-8s %-46s %s\n' "$what" "$port" "$url" "$s"
}

row "Shop and admin"        5173  "http://localhost:5173"
row "API behind nginx"      8080  "http://localhost:8080/health"
row "Prometheus"            9090  "http://localhost:9090/targets"
row "Grafana"               3000  "http://localhost:3000/d/blitzy-security" -u "admin:${GRAFANA_PW:-admin}"
row "Wazuh dashboard"       5601  "http://localhost:5601/app/dashboards"
row "API dev server"        8000  "http://localhost:8000/api/products"

printf '\n  Not published to the host, reachable only inside the Docker network:\n'
printf '    %-24s %s\n' "Wazuh indexer"   "wazuh-indexer:9200"
printf '    %-24s %s\n' "Wazuh manager"   "wazuh:55000, plus 1514-1516 and 514/udp for agents"
printf '    %-24s %s\n' "Loki"            "loki:3100"
printf '    %-24s %s\n' "API container"   "api:8000"

printf '\n  Data stores, bound to loopback only:\n'
printf '    %-24s %s\n' "PostgreSQL" "127.0.0.1:55433"
printf '    %-24s %s\n' "Redis"      "127.0.0.1:56379"
printf '    %-24s %s\n' "MongoDB"    "127.0.0.1:57017"

say "Do the dashboards have anything to show"

PROM="$(curl -s --get "http://127.0.0.1:9090/api/v1/query" --data-urlencode 'query=sum(http_requests_total)' 2>/dev/null | grep -oE '"[0-9.]+"\]' | tr -dc '0-9.')"
printf '  %-26s %s\n' "requests scraped" "${PROM:-0}"

ALERTS="$($COMPOSE exec -T wazuh-indexer curl -s "http://localhost:9200/wazuh-alerts-*/_count" \
  -H "Content-Type: application/json" -d '{"query":{"term":{"rule.groups":"ecommerce"}}}' 2>/dev/null \
  | grep -oE '"count":[0-9]+' | cut -d: -f2)"
printf '  %-26s %s\n' "custom Wazuh alerts" "${ALERTS:-0}"

SURI="$($COMPOSE exec -T suricata sh -c 'grep -c "\"event_type\":\"alert\"" /var/log/suricata/eve.json' 2>/dev/null | tr -d ' \r')"
printf '  %-26s %s\n' "Suricata alerts" "${SURI:-0}"

if [ "${ALERTS:-0}" -lt 20 ] 2>/dev/null || [ -z "${PROM:-}" ]; then
  printf '\n  %s\n' "$(y 'Thin. Run these before recording:')"
  printf '    bash scripts/demo-data.sh quick\n'
  printf '    bash scripts/demo-security-events.sh\n'
fi

say "The client is not a container"
if [ "$(code http://localhost:5173)" = "200" ]; then
  printf '  %s on 5173\n' "$(g running)"
else
  printf '  %s. Start it in its own terminal:\n\n    cd client && npm run dev\n' "$(r 'not running')"
fi
printf '  It must be 5173. Only that origin is allowed by CORS, so a tab on 5174 fails every call.\n'

printf '\n  Everything else: bash scripts/up.sh check\n'
printf '  What to open, in order: docs/DEMO-ROUTES.md\n\n'
