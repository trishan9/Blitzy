#!/usr/bin/env bash
set -u

API="${API:-http://localhost:8080}"
MODE="${1:-full}"
if [ "$MODE" = "quick" ]; then LOOPS=1; else LOOPS=4; fi

hit()  { curl -s -o /dev/null -w '' "$@" 2>/dev/null || true; }
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
tick() { printf '.'; }

if ! curl -s -o /dev/null --max-time 3 "$API/api/products"; then
  echo "The API is not answering on $API"
  echo "Start it first:  docker compose --profile app --profile detection up -d"
  exit 1
fi

say "1/7  Normal browsing, so the request-rate panel has a floor"
for _ in $(seq 1 $((LOOPS * 60))); do
  hit "$API/api/products"
  hit "$API/api/products?page=2"
  hit "$API/api/categories"
  tick
done
echo

say "2/7  A password spraying burst, so auth_login_failure_total spikes"
for i in $(seq 1 $((LOOPS * 12))); do
  hit -X POST "$API/api/auth/sign-in/email" \
      -H 'content-type: application/json' \
      -d "{\"email\":\"sunita@shop.test\",\"password\":\"wrong-$i\"}"
  tick
done
echo

say "3/7  Enough volume for the request-rate and status panels to have shape"
for _ in $(seq 1 $((LOOPS * 90))); do
  hit "$API/api/products?sort=price"
  tick
done
echo

say "4/7  Attacks that are refused, so the error panels and the audit trail fill"
for _ in $(seq 1 $((LOOPS * 6))); do
  hit "$API/api/admin/users"
  hit "$API/api/admin/analytics"
  hit -X POST "$API/api/uploads/products/image-from-url" \
      -H 'content-type: application/json' \
      -d '{"url":"http://169.254.169.254/latest/meta-data/"}'
  hit "$API/api/products?sort=%27%20OR%201%3D1--"
  hit "$API/api/products?q=%3Cscript%3Ealert(1)%3C/script%3E"
  hit "$API/api/uploads/../../../../etc/passwd"
  hit -X POST "$API/api/cart" -H 'content-type: application/json' -d '{"items":[]}'
  hit -X POST "$API/api/reviews" -H 'content-type: application/json' -d '{'
  tick
done
echo

say "5/7  A real signed-in journey, so the success panels are not empty"
CJ="$(mktemp)"
for _ in $(seq 1 $LOOPS); do
  TOKEN=$(curl -s -c "$CJ" "$API/api/csrf-token" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)
  curl -s -o /dev/null -b "$CJ" -c "$CJ" -X POST "$API/api/auth/sign-in/email" \
    -H 'content-type: application/json' -H "x-csrf-token: $TOKEN" \
    -d '{"email":"sunita@shop.test","password":"Nepal@Shop2026!"}' 2>/dev/null || true
  curl -s -o /dev/null -b "$CJ" "$API/api/me" 2>/dev/null || true
  curl -s -o /dev/null -b "$CJ" "$API/api/orders" 2>/dev/null || true
  tick
done
rm -f "$CJ"
echo

say "6/7  Traffic on the Docker network, so Suricata has packets to count"
if command -v docker >/dev/null 2>&1; then
  docker run --rm --network blitzy_internal curlimages/curl:latest -s -o /dev/null \
    --max-time 20 http://api:8000/api/products 2>/dev/null || true
  for _ in $(seq 1 20); do
    docker run --rm --network blitzy_internal curlimages/curl:latest -s -o /dev/null \
      --max-time 5 "http://api:8000/api/products?n=$RANDOM" 2>/dev/null || true
    tick
  done
fi
echo

say "7/7  Feeding the security events to Wazuh"
echo "Wazuh counts toward its eight-in-two-minutes threshold as lines arrive, so this drips"
echo "them in rather than pasting the block at once. A batch alerts on every line but never"
echo "trips the composite rule."
docker compose logs api --no-log-prefix --since 30m 2>/dev/null   | grep '^{' | grep sec_event > /tmp/blitzy-sec-events.txt
COUNT=$(wc -l < /tmp/blitzy-sec-events.txt | tr -d ' ')
echo "  $COUNT events"
while IFS= read -r line; do printf '%s
' "$line" >> logs/api.log; sleep 1; done   < /tmp/blitzy-sec-events.txt
rm -f /tmp/blitzy-sec-events.txt
sleep 15
echo "  custom rule alerts now recorded:"
docker compose exec -T wazuh sh -c   'grep -o "\"id\":\"1000[0-9][0-9]\"" /var/ossec/logs/alerts/alerts.json | sort | uniq -c'   2>/dev/null | sed 's/^/    /'
echo
echo "  Open http://localhost:5601 -> Dashboards -> Blitzy security events"

say "Done. What each dashboard should now show"
cat <<'EOF'

  Prometheus   http://127.0.0.1:9090/graph
      rate(http_requests_total[1m])                       a busy line with a clear shape
      auth_login_failure_total                            a step up from the spraying burst
      sum by (status) (http_requests_total)               200s next to 400s, 401s, 403s, 404s, 429s

  Prometheus   http://127.0.0.1:9090/targets
      the API target UP

  Grafana      http://127.0.0.1:3000   admin, password from GRAFANA_PW in .env
      request rate and error rate over the last 15 minutes

  Loki         Grafana, Explore, pick Loki
      {container="/blitzy-api-1"}                          the log stream
      {container="/blitzy-api-1"} |= "correlationId"       pick one id and follow it

  Wazuh        docker compose exec wazuh tail -n 40 /var/ossec/logs/ossec.log
      the manager running with the custom rules loaded

  Suricata     docker compose exec suricata sh -c 'grep "rules successfully loaded" /var/log/suricata/suricata.log | tail -1'
               docker compose exec suricata sh -c 'grep \"event_type\":\"alert\" /var/log/suricata/eve.json | tail -1'
      52,132 signatures loaded, and a packet count that is no longer zero

EOF
echo "Counters as Prometheus scraped them:"
for q in "sum(auth_login_failure_total)" "sum(http_requests_total)"; do
  printf '  %-28s ' "$q"
  curl -s --get "http://127.0.0.1:9090/api/v1/query" --data-urlencode "query=$q"     | grep -oE '"value":\[[0-9.]+,"[0-9.]+"\]' | grep -oE '"[0-9.]+"\]$' | tr -dc '0-9.'
  echo
done
