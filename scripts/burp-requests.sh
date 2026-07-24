#!/usr/bin/env bash
set -u

API="${API:-http://localhost:8080}"
ORIGIN="${ORIGIN:-http://localhost:5173}"
OUT="docs/burp"
PW='Nepal@Shop2026!'

mkdir -p "$OUT"
rm -f "$OUT"/*.txt

if ! curl -s -o /dev/null --max-time 4 "$API/api/products"; then
  echo "Nothing is answering on $API"
  echo "Start it with: docker compose --profile app --profile detection up -d"
  exit 1
fi

login() {
  local email="$1" jar="$2" tok
  rm -f "$jar"
  tok=$(curl -s -c "$jar" "$API/api/csrf-token" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)
  curl -s -o /dev/null -b "$jar" -c "$jar" -X POST "$API/api/auth/sign-in/email" \
    -H 'content-type: application/json' -H "Origin: $ORIGIN" -H "x-csrf-token: $tok" \
    -d "{\"email\":\"$email\",\"password\":\"$PW\"}"
  awk 'NF>6 && ($1 !~ /^#/ || $1 ~ /^#HttpOnly_/) {printf "%s=%s; ", $6, $7}' "$jar" | sed 's/; $//'
}

csrf_for() {
  curl -s -b "$1" -c "$1" "$API/api/csrf-token" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4
}

SJ=$(mktemp); BJ=$(mktemp)
echo "Signing in..."
jar_cookies() { awk 'NF>6 && ($1 !~ /^#/ || $1 ~ /^#HttpOnly_/) {printf "%s=%s; ", $6, $7}' "$1" | sed 's/; $//'; }

login "sunita@shop.test" "$SJ" >/dev/null
login "bibek@shop.test" "$BJ" >/dev/null
SUNITA_CSRF=$(csrf_for "$SJ"); SUNITA_COOKIE=$(jar_cookies "$SJ")
BIBEK_CSRF=$(csrf_for "$BJ");  BIBEK_COOKIE=$(jar_cookies "$BJ")
ANON_JAR=$(mktemp)
ANON_CSRF=$(curl -s -c "$ANON_JAR" -b "$ANON_JAR" "$API/api/csrf-token" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)
ANON_COOKIE=$(jar_cookies "$ANON_JAR")

ORDER_ID=$(curl -s -b "$SJ" "$API/api/orders" | grep -o '"_id":"[^"]*' | head -1 | cut -d'"' -f4)
PRODUCT_ID=$(curl -s "$API/api/products" | grep -o '"_id":"[^"]*' | head -1 | cut -d'"' -f4)
SLUG=$(curl -s "$API/api/products" | grep -o '"slug":"[^"]*' | head -1 | cut -d'"' -f4)

w() { printf '%s\n' "$2" > "$OUT/$1"; echo "  $OUT/$1"; }

echo "Writing requests..."

w "01-sqli-injection-400.txt" "GET /api/products?sort=(SELECT%20CASE%20WHEN%20(1=1)%20THEN%20name%20END) HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Connection: close

"

w "02-sqli-valid-200.txt" "GET /api/products?sort=price-low HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Connection: close

"

w "03-idor-other-customers-order-404.txt" "GET /api/orders/$ORDER_ID HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Cookie: $BIBEK_COOKIE
Connection: close

"

w "04-admin-route-as-customer-404.txt" "GET /api/admin/users HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Cookie: $BIBEK_COOKIE
Connection: close

"

BODY="{\"productId\":\"$PRODUCT_ID\",\"rating\":5,\"comment\":\"<script>alert(1)</script> great product\"}"
w "05-stored-xss-review-needs-a-purchase.txt" "POST /api/reviews HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $SUNITA_COOKIE
x-csrf-token: $SUNITA_CSRF
Content-Length: ${#BODY}
Connection: close

$BODY"

w "06-read-back-the-review.txt" "GET /api/products/$SLUG/reviews HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Connection: close

"

CART="{\"items\":[{\"productId\":\"$PRODUCT_ID\",\"quantity\":1}]}"
w "07-csrf-missing-token-403.txt" "POST /api/cart HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $ANON_COOKIE
Content-Length: ${#CART}
Connection: close

$CART"

w "08-csrf-with-token-200.txt" "POST /api/cart HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $ANON_COOKIE
x-csrf-token: $ANON_CSRF
Content-Length: ${#CART}
Connection: close

$CART"

w "09-cors-evil-origin.txt" "GET /api/products HTTP/1.1
Host: ${API#http://}
Origin: https://evil.test
Connection: close

"

SSRF='{"url":"http://169.254.169.254/latest/meta-data/"}'
w "10-ssrf-cloud-metadata-404.txt" "POST /api/uploads/products/image-from-url HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $SUNITA_COOKIE
x-csrf-token: $SUNITA_CSRF
Content-Length: ${#SSRF}
Connection: close

$SSRF"

w "11-path-traversal-404.txt" "GET /api/uploads/../../../../etc/passwd HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Connection: close

"

BAD='{ this is not json'
w "12-malformed-body-400.txt" "POST /api/reviews HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $SUNITA_COOKIE
x-csrf-token: $SUNITA_CSRF
Content-Length: ${#BAD}
Connection: close

$BAD"

CO="{\"email\":\"sunita@shop.test\",\"password\":\"wrong-password\"}"
w "13-bruteforce-intruder.txt" "POST /api/auth/sign-in/email HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $ANON_COOKIE
x-csrf-token: $ANON_CSRF
Content-Length: ${#CO}
Connection: close

$CO"

ADDR=$(curl -s -b "$SJ" "$API/api/addresses" | grep -oE '"(_id|id)":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4)
ADDR="${ADDR:-REPLACE_WITH_AN_ADDRESS_ID}"
CHK="{\"addressId\":\"$ADDR\",\"paymentMethod\":\"CASH_ON_DELIVERY\",\"totalPaisa\":1}"
w "14-price-tampering-400.txt" "POST /api/orders/checkout HTTP/1.1
Host: ${API#http://}
Origin: $ORIGIN
Content-Type: application/json
Cookie: $SUNITA_COOKIE
x-csrf-token: $SUNITA_CSRF
Content-Length: ${#CHK}
Connection: close

$CHK"

rm -f "$SJ" "$BJ" "$ANON_JAR"

cat <<EOF

Done. In Burp: Repeater, new tab, click in the request pane, Ctrl+V.

Captured for you:
  sunita order id : ${ORDER_ID:-none, place an order or run npm run seed:all}
  product id      : $PRODUCT_ID
  product slug    : $SLUG

Two notes:
  * 05 returns 400 or 404 until sunita has actually bought that product, because only a
    verified purchaser may review. Buy it in the app first, or run the XSS demo from the UI.
  * 10 answers 404 rather than 400: the route is admin only, so authorization refuses it
    before the SSRF guard is reached. Sign in as admin@shop.test to see the 400 instead.
  * 14 carries a live address id if sunita has one. If it still says REPLACE_WITH, add an
    address in the app as sunita and re-run this script.
  * Sessions expire. Re-run this script whenever a request starts returning 401.
EOF
