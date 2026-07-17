# Burp Suite Testing Guide: Blitzy

How to reproduce every finding in the report by hand, and how to show each control both failing
(naive build) and holding (secure build). Each section maps to a class table in **Section 5**.
For the recording itself, see [FINAL-DEMO-SCRIPT.md](FINAL-DEMO-SCRIPT.md).

---

## Read this first, or nothing will work

### Burp's proxy listener and the nginx edge both want port 8080

Burp's default proxy listener is `127.0.0.1:8080`. The nginx edge publishes on `0.0.0.0:8080`.
Whichever starts first takes the port and the other fails.

**Move Burp's listener.** Nothing in this guide goes through the proxy, so the port is arbitrary:

> Settings → Tools → **Proxy** → select the `127.0.0.1:8080` listener → **Edit** → bind port
> **8081** → OK.

If you skip this, Burp reports that it could not start its listener and every request you send
to `localhost:8080` is answered by Burp itself rather than by nginx.

### Which port to attack

| Port | What answers | Use it for |
|---|---|---|
| **8080** | nginx, ModSecurity, then the containerised API | **almost everything**. This is the only path Suricata sees and the only one whose log reaches Wazuh |
| 8000 | the development server on your machine, directly | isolating the application layer when the WAF would muddy which layer refused a request |

Two layers give two different answers, and that is worth showing rather than hiding. An obvious
payload is refused with **403 by ModSecurity** before the application sees it. A payload that
looks ordinary passes the rule set and is refused by the application, usually with **400** or
**404**. The CRS paranoia level is 1 on purpose, so a determined encoding slips past the edge and
is still stopped by the application. That is the point.

An unknown `Host` header is dropped outright at the edge (444), and `TRACE` returns 405.


## 1. Setup

### 1.1 Bring the system up

The whole thing, including the edge and the monitoring stack:

```bash
docker compose --profile app --profile detection up -d
docker compose ps                        # 13 containers, all Up
cd client && npm run dev                 # app on :5173, and only 5173
```

Only `http://localhost:5173` is allowed by CORS. A second client instance on 5174 fails every
call and looks like a broken application.

If you also want the development server on 8000, for the flag-off half of a pair:

```bash
cd backend && npm run seed:all           # predictable data
cd backend && npm run dev                # API on :8000
```

**Test accounts** (all share the password `Nepal@Shop2026!`):

| Account | Role | Use it for |
|---|---|---|
| `admin@shop.test` | ADMIN | admin panel, upload and AI tests |
| `bibek@shop.test` | USER | the "attacker" account in access control tests |
| `sunita@shop.test` | USER | the "victim" account |

### 1.2 Burp configuration

1. **Proxy listener**: move it to `127.0.0.1:8081`, as above. It must not sit on 8080.
2. **Target → Scope**: include `http://localhost:8080`, `http://localhost:8000` and
   `http://localhost:5173`, and nothing else. Keeping scope tight is part of the ethical rules:
   nothing outside this machine is ever tested.
3. **Extensions** from the BApp Store: **JWT Editor** (needed for the alg:none test),
   **Turbo Intruder** (needed for the race condition), and optionally **Autorize**,
   **Param Miner**, **Upload Scanner**.

No browser proxy extension and no CA certificate are needed, and FoxyProxy is not used anywhere
in this project. Every test here is sent from Repeater or Intruder, neither of which goes through
a browser. If you do want to click through the application with traffic captured, use
**Proxy → Intercept → Open Browser**, which is Burp's own Chromium, already configured and
already trusting its own certificate.

### 1.2b Getting a request into Repeater

Every raw request in `docs/burp/` is used the same way:

1. **Repeater** tab → the **+** button for a new tab
2. click anywhere in the left-hand request pane
3. `Ctrl+A`, then `Ctrl+V` to replace whatever is there
4. **Send**

Burp recalculates `Content-Length` on send, so never count characters by hand.

Generate the files first. They arrive with a live session cookie and CSRF token already filled
in, and with real product and order ids:

```bash
bash scripts/burp-requests.sh
```

Re-run that whenever you start getting 401 or 403 on requests that worked earlier. It means the
session or the token went stale, not that a control changed.

### 1.3 The one thing that trips people up: CSRF

Every state-changing request needs a token. Get one and reuse it in Repeater:

```
GET /api/csrf-token          →  {"csrfToken":"..."}
```

Add to any POST/PUT/DELETE you replay:

```
x-csrf-token: <the token>
Origin: http://localhost:5173
```

A request without these returns **403**, that is the CSRF control working, not a broken test.

### 1.4 Turning a control off (the "before" half)

The naive implementations live behind demo flags, gated so they can never run in production.
Stop the API, restart it with a flag, capture the result, then restart without it:

```bash
# vulnerable build
DEMO_MODE=true TRUST_CLIENT_TOTAL=true npm run dev

# secure build (normal)
npm run dev
```

There are **23** flags. Print the live list, with the CWE and the endpoint each one affects,
rather than trusting a list in a document:

```bash
cd backend && npm run demo:list
```

| Flag | CWE | Class |
|---|---|---|
| `DISABLE_SQL_ALLOWLIST` | CWE-89 | SQL injection in `ORDER BY` |
| `MONGO_RAW_FILTER` | CWE-943 | NoSQL injection |
| `DISABLE_OUTPUT_SANITISE` | CWE-79 | Stored XSS |
| `DISABLE_CSRF` | CWE-352 | CSRF |
| `REFLECT_CORS_ORIGIN` | CWE-942 | CORS misconfiguration |
| `DISABLE_SSRF_GUARD` | CWE-918 | SSRF |
| `SHELL_OUT_FOR_PDF` | CWE-78 | Command injection |
| `TRUST_UPLOAD_FILENAME` | CWE-22 | Path traversal |
| `TRUST_UPLOAD_MIMETYPE` | CWE-434 | Unrestricted file upload |
| `DISABLE_LOCKOUT` | CWE-307 | Broken brute-force protection |
| `TRUST_CLIENT_TOTAL` | CWE-840 | Client-controlled price |
| `NON_ATOMIC_STOCK` | CWE-362 | Race condition, oversell |
| `VERBOSE_ERRORS` | CWE-209 | Information disclosure |
| `RENDER_LLM_MARKDOWN` | CWE-79 | Model output exfiltration |
| `UNSAFE_DESERIALIZE` | CWE-502 | Insecure deserialization |
| `USE_NAIVE_JWT_VERIFIER` | CWE-347 | JWT, umbrella switch |
| `JWT_ACCEPT_ALG_NONE` | CWE-347 | JWT `alg:none` |
| `JWT_SKIP_VERIFY` | CWE-347 | signature never checked |
| `JWT_ALLOW_HS256` | CWE-347 | algorithm confusion |
| `JWT_WEAK_HMAC_SECRET` | CWE-326 | weak key |
| `JWT_TRUST_KID` | CWE-347 | `kid` injection and traversal |
| `JWT_TRUST_JKU` | CWE-347 | `jku` SSRF and key injection |
| `JWT_SKIP_EXPIRY` | CWE-613 | expiry not checked |

Enable exactly one at a time. The application refuses to start with any flag set unless
`NODE_ENV` is not production **and** `DEMO_MODE=true`, so this cannot reach a deployment.

Every pair is also automated: `npm run demo:pairs` asserts the control holds when secure **and**
breaks when the flag is on. A control that cannot be shown to break has not been shown to work.

---

## 2. Injection

### 2.1 SQL injection, Table 5.1, screenshot D6

**Tools:** Repeater, sqlmap.

1. Send `GET /api/products?sort=price&dir=asc`, confirm the ordering changes.
2. In Repeater, replace the sort value with an injection attempt:
   ```
   GET /api/products?sort=(SELECT CASE WHEN (1=1) THEN name ELSE price END)&dir=asc
   ```
   **Secure result:** `400`, or the response silently falls back to the default ordering. Nothing
   is injected because `sort` selects a column from a fixed map.
3. Time-based attempt: `?sort=(SELECT pg_sleep(5))`, response is immediate, and the database role
   carries a five second statement timeout as a second limit.
4. Confirm with sqlmap:
   ```bash
   sqlmap -u "http://localhost:8000/api/products?sort=name&dir=asc" -p sort \
          --dbms=postgres --level=5 --risk=3 --batch
   ```
   **Secure result:** all tested parameters reported not injectable.
5. **Before half:** restart with `DEMO_MODE=true DISABLE_SQL_ALLOWLIST=true` and repeat step 4;
   sqlmap now identifies the parameter as injectable.

### 2.2 NoSQL injection, Table 5.2

**Tools:** Repeater.

1. As admin, send:
   ```http
   POST /api/admin/activity/search
   {"action":"LOGIN"}
   ```
   Note the number of records returned.
2. Replace the scalar with an operator object:
   ```json
   {"action":{"$ne":null}}
   ```
   **Secure result:** `400`. The schema accepts strings only, so the object never reaches the driver.
3. **Before half:** `DEMO_MODE=true MONGO_RAW_FILTER=true`, the same payload now returns every record.

### 2.3 Cross-site scripting, Table 5.3, screenshot D3

**Tools:** Repeater, browser.

1. Sign in and find a delivered order item you can review (`GET /api/reviews/reviewable`).
2. Submit a review whose comment is:
   ```html
   <script>alert(document.domain)</script><img src=x onerror=alert(1)>
   ```
3. Read it back with `GET /api/products/<slug>/reviews`.
   **Secure result:** the stored comment is plain text; the script and image tags are gone.
4. Open the product page in the browser: nothing executes, and the console shows no CSP violation
   because there is nothing left to block.
5. Check the policy header on any page: `Content-Security-Policy: script-src 'nonce-...'`.
6. **Before half:** `DEMO_MODE=true DISABLE_OUTPUT_SANITISE=true`, the markup is stored verbatim.

---

## 3. Access control and identity

### 3.1 Access control and IDOR, Table 5.7, screenshot D4

**Tools:** Autorize, Repeater.

1. Log in as **sunita** in the browser, place an order, and note its id from `GET /api/orders`.
2. Log in as **bibek** in a second browser or a private window.
3. Configure **Autorize** with bibek's `Cookie` header, then browse the site as sunita.
4. Autorize replays every request with bibek's session.
   **Secure result:** every one of sunita's order requests is marked *Bypassed? No*, returning
   **404**. A 404 rather than 403 is deliberate: 403 would confirm the record exists.
5. In Repeater, as bibek, request sunita's order directly:
   `GET /api/orders/<sunita-order-id>` → **404**.
6. Try the admin surface as bibek: `GET /api/admin/analytics` → **404**.
7. Header bypass attempts, all ignored:
   ```
   X-Original-URL: /api/admin/analytics
   X-Rewrite-URL: /api/admin/analytics
   X-HTTP-Method-Override: GET
   ```

### 3.2 Authentication and session, Table 5.8, screenshot D5

**Tools:** Repeater, Intruder.

1. **No account enumeration.** Send two sign-in attempts, one for a real address with a wrong
   password and one for an address that does not exist:
   ```http
   POST /api/auth/sign-in/email
   {"email":"bibek@shop.test","password":"wrong"}
   {"email":"nobody@nowhere.test","password":"wrong"}
   ```
   **Secure result:** both return **401** with the identical body
   `{"message":"Invalid email or password"}`. Compare response times in Burp's timing column;
   they are equivalent, so timing gives nothing away either.
2. **Rate limiting.** Send the wrong-password request to Intruder with a password list.
   **Secure result:** requests begin returning **429** after a few attempts. Repeat from a
   different source address: the per-account limit still applies, so rotating addresses does not help.
3. **Ban revokes a live session.** Capture bibek's session cookie while signed in. As admin,
   `PUT /api/admin/users/<bibek-id>/ban` with `{"banned":true}`. Immediately replay bibek's earlier
   request in Repeater with the captured cookie.
   **Secure result:** **401** on the very next request.

### 3.3 JWT, Table 5.9, screenshot D7

**Tools:** JWT Editor, jwt_tool.

1. Obtain a token from `GET /api/auth/token` and load it into **JWT Editor**.
2. **alg:none:** change the header to `{"alg":"none","typ":"JWT"}` and remove the signature.
   **Secure result:** **401**. The algorithm is fixed server side.
3. **Key injection:** add a `jku` header pointing at a URL you control.
   **Secure result:** **401**, and the URL is never requested. Confirm with Burp Collaborator that
   no callback arrives.
4. **Algorithm confusion:** re-sign with HS256 using the public key as the secret.
   **Secure result:** **401**.
5. **Expiry:** edit `exp` to a past timestamp. **Secure result:** **401**.

---

## 4. Business logic and payments

### 4.1 Price tampering, Table 5.11, screenshots D1 and D2

This is the highest-severity class in the report and the clearest demonstration.

1. Add an item to the cart in the browser and proceed to checkout, capturing the request:
   ```http
   POST /api/orders/checkout
   {"addressId":"<uuid>","paymentMethod":"CASH_ON_DELIVERY"}
   ```
   Note the total in the response.
2. In Repeater, add a money field:
   ```json
   {"addressId":"<uuid>","paymentMethod":"CASH_ON_DELIVERY","totalPaisa":1}
   ```
   **Secure result:** **400 invalid request body**. The schema is strict and the request type has
   no money field at all, so the value is not merely ignored, it is refused. *(Screenshot D1.)*
3. Try the other spellings: `total`, `subtotal`, `amount`, `price`, `discount`. All **400**.
4. Use **Param Miner** → *Guess JSON parameter names* on the endpoint to confirm no hidden money
   parameter exists.
5. **Before half:** restart with `DEMO_MODE=true TRUST_CLIENT_TOTAL=true` and resend step 2. The
   order is created and billed **one paisa** for a Rs 5000 basket. *(Screenshot D2.)*

### 4.2 eSewa amount tampering, Table 5.11

1. Start an eSewa payment: `POST /api/orders/checkout` with `"paymentMethod":"ESEWA"`.
2. The response contains the signed form fields. Edit `total_amount` to `1` and submit the form.
   **Secure result:** the payment is rejected. The signature no longer matches, and even a valid
   looking return is re-confirmed with eSewa server to server and compared against the stored total
   before the order can be marked paid.

### 4.3 Race conditions, Table 5.12, screenshot D10

**Tools:** Turbo Intruder.

1. Find the single-stock product created by the seed (stock = 1).
2. Add it to the cart, then capture the checkout request and send it to **Turbo Intruder**.
3. Use the `race.py` template to fire 30 concurrent copies in one connection.
   **Secure result:** exactly **one** returns 201; the rest return **409 out of stock**. Confirm in
   the database that stock is 0 and never negative.
4. Repeat with a single-use coupon: only one redemption succeeds.
5. **Before half:** `DEMO_MODE=true NON_ATOMIC_STOCK=true`, around ten orders succeed for one unit
   of stock, and stock goes negative.

### 4.4 Mass assignment, Table 5.7

1. Attempt privilege escalation on your own profile:
   ```http
   PATCH /api/me
   {"name":"Bibek","role":"ADMIN"}
   ```
   **Secure result:** **400**. Unknown fields are rejected rather than silently dropped.
2. Confirm the role is unchanged with `GET /api/auth/get-session`.

---

## 5. Server side and infrastructure

### 5.1 SSRF, Table 5.6

**Tools:** Repeater, Collaborator.

1. As admin, use the image import endpoint:
   ```http
   POST /api/uploads/products/image-from-url
   {"url":"http://169.254.169.254/latest/meta-data/","productId":"<uuid>"}
   ```
   **Secure result:** blocked, and an `SSRF_BLOCKED` entry is written to the audit log.
2. Try the internal database and the encodings that defeat naive string filters:
   ```
   http://postgres:5432/
   http://127.0.0.1:5432/
   http://2130706433/            (decimal)
   http://[::ffff:127.0.0.1]/    (IPv6-mapped)
   http://localtest.me/          (public name resolving to 127.0.0.1)
   ```
   **Secure result:** all blocked. The decision is made on the resolved address, not the text.
3. Point at a Collaborator URL that redirects to `127.0.0.1`. **Secure result:** the redirect is
   re-validated and refused.
4. **Before half:** `DEMO_MODE=true DISABLE_SSRF_GUARD=true`, the metadata request succeeds.

### 5.2 File upload, Table 5.10, screenshot D8

**Tools:** Repeater, Upload Scanner.

1. Create a PHP file and rename it:
   ```bash
   printf '<?php system($_GET["c"]); ?>' > shell.png
   ```
2. Upload as admin to `POST /api/uploads/images` with `Content-Type: image/png`.
   **Secure result:** **400**. The claimed type is ignored; the magic bytes decide.
3. Build a real polyglot (valid PNG header with PHP appended) and upload it.
   **Secure result:** accepted as an image, but the stored file is re-encoded, so fetching it back
   shows the payload is gone.
4. Filename traversal: send `../../evil.png` as the filename. **Secure result:** the stored name is
   a server-generated UUID; the supplied name never touches the filesystem.
5. Check the serve headers on `GET /api/uploads/<key>`: `X-Content-Type-Options: nosniff`,
   `Content-Disposition: attachment`, and a restrictive `Content-Security-Policy`.
6. **Before half:** `DEMO_MODE=true TRUST_UPLOAD_MIMETYPE=true`, `shell.png` is stored.

### 5.3 Path traversal, Table 5.15

```
GET /api/uploads/../../etc/passwd
GET /api/uploads/..%2f..%2fetc%2fpasswd
GET /api/uploads/%252e%252e%252fetc%252fpasswd
```
**Secure result:** **404** for all. The key must match a UUID plus `.webp`, so it cannot express a path.

### 5.4 CORS, Table 5.5, screenshot D9

1. Replay any authenticated request with a forged origin:
   ```
   Origin: https://evil.example.com
   ```
   **Secure result:** no `Access-Control-Allow-Origin` header in the response at all.
2. Try the classic bypasses, all refused:
   ```
   Origin: https://localhost:5173.evil.com
   Origin: https://evil-localhost:5173
   Origin: null
   ```
3. With the allowed origin `http://localhost:5173` the header appears with
   `Access-Control-Allow-Credentials: true`.
4. **Before half:** `DEMO_MODE=true REFLECT_CORS_ORIGIN=true`, the evil origin is reflected.

### 5.5 CSRF, Table 5.4

1. Use **Engagement tools → Generate CSRF PoC** on a state-changing request such as
   `POST /api/addresses`.
2. Save the generated HTML, open it in a browser where you are signed in, and submit.
   **Secure result:** **403 invalid csrf token**.
3. Replay in Repeater with the header removed. **Secure result:** **403**, not a silent success.
4. Take a valid token from a *different* account and use it against this one.
   **Secure result:** **403**, because the token is bound to the session.
5. **Before half:** `DEMO_MODE=true DISABLE_CSRF=true`, the cross-site request succeeds.

### 5.6 Information disclosure, Table 5.13

1. Force an error, for example a malformed UUID: `GET /api/orders/not-a-uuid`.
   **Secure result:** `{"error":"...","correlationId":"..."}` with no stack trace, no SQL and no
   library versions.
2. Trigger a duplicate key by registering an existing address.
   **Secure result:** a generic message; the constraint name `users_email_uq` never appears, so it
   cannot be used to enumerate accounts.
3. Check for banners and hidden files: `X-Powered-By` is absent; `/.git/config`, `/.env` and
   `/api/metrics` are not reachable from outside.
4. `TRACE /api/products` → **405**.
5. **Before half:** `DEMO_MODE=true VERBOSE_ERRORS=true`, the full stack trace is returned.

### 5.7 Clickjacking, smuggling and headers, Table 5.18

1. Check the security headers on any response: `Content-Security-Policy` with
   `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
   `Strict-Transport-Security`, `Referrer-Policy`.
2. Frame the app in a local HTML file; the browser refuses to render it.
3. Request smuggling: send a request carrying both `Content-Length` and `Transfer-Encoding`.
   **Secure result:** **400**, rejected before any parser sees the body.
4. Host header: send `Host: evil.com` and confirm no generated link or redirect adopts it.

---

## 6. Reporting checklist

For every finding you write up, capture:

1. **Request and response** in Repeater, both halves of the pair, with status codes visible.
2. **The exact payload**, so a marker can retype it.
3. **The evidence of impact**: a database row, a log line, or the absence of one.
4. **The remediation**, quoting the control from Section 5 of the report.
5. **The retest**, showing the secure build refusing the same request.

Because every pair is also asserted by `npm run demo:pairs`, the behaviour is deterministic: the
same command produces the same result on any machine, which is what the evidence quality
requirement asks for.

## 7. Ethics and scope

Testing is confined to the local instance described in section 1. No third-party service is
attacked; the eSewa tests use the sandbox gateway. Nothing here should be run against a system
you do not own or have written permission to test.
