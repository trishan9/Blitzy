# Blitzy: What Every Part Is For

A plain-language map of the whole system. For each piece: what it is, why it is in the project,
and what would go wrong without it.

Companion documents: **`FINAL-DEMO-SCRIPT.md`** (the recording), **`BURP-GUIDE.md`**
(how to test each control by hand).

---

## 1. The shape of the system in one paragraph

A React application in the browser talks to one Express API. That API is the only place that
decides who may do what. Behind it sit three data stores, each with a different job, and beside it
sits a monitoring stack that records what happened. Two payment providers and one AI provider are
reached outbound, never inbound. Everything runs in Docker so the same setup can be rebuilt on any
machine.

The single rule the design follows: **the browser is assumed to be controlled by an attacker**, so
nothing the browser sends is trusted and nothing the browser is told is relied on.

---

## 2. Application services

### The client (`client/`)
**React 19 with Vite 7, Tailwind and shadcn/ui.** The storefront and the admin panel.

It holds no secret and no token. The session lives in a cookie the browser will not let JavaScript
read, so a scripting flaw has nothing to steal. The cart is kept locally for responsiveness, but
every amount is recalculated by the server when it syncs, so the local copy can never decide a
price. The admin menu is hidden from customers as a convenience only; the server refuses admin
routes regardless of what the interface shows.

| Folder | Purpose |
|---|---|
| `pages/` | One folder per screen: home, products, checkout, orders, account, admin |
| `components/` | Shared interface pieces, including the cart drawer and product cards |
| `layouts/` | Page frames, including the admin frame that checks the session |
| `hooks/` | `use-cart` (local cart plus server sync), `use-session` (asks the server who you are) |
| `lib/` | `axios-client` (attaches the CSRF token, retries once if refused), `api` (every endpoint) |
| `routes/` | Route table and the guard that redirects when there is no session |

### The API (`backend/`)
**Express 5 on TypeScript.** The single authorization boundary. Every request passes the same
ordered pipeline before it reaches a handler.

| Folder | Purpose | Why it matters |
|---|---|---|
| `routes/secure/` | Every endpoint: products, cart, orders, payments, reviews, uploads, admin, AI | All mounted behind the same guards, so no route can quietly skip one |
| `authz/` | `policy.ts` decides who may do what; `authorize.ts` enforces it | Default deny: an action not explicitly allowed is refused |
| `checkout/` | Recomputes every amount, applies coupons, decrements stock atomically | The client sends no money field at all, so a price cannot be tampered with |
| `orders/` | The order state machine and the shared order serializer | Illegal status jumps are rejected; one place decides what an order looks like |
| `security/` | The security primitives, listed in section 3 below | Each concern is written once and reused |
| `auth/` | Session handling, token verification, guest-cart signing | Identity comes only from a verified session |
| `db/` | Schema, migrations, seeds, and the transaction helpers | Row-Level Security and constraints live here |
| `uploads/` | The image pipeline: type detection, re-encoding, safe naming | Nothing executable can be stored or served |
| `ai/` | Input scanning, context marking, output guarding for the assistant | The model is treated as untrusted in both directions |
| `payments/` | eSewa signing and verification, Stripe webhook verification | An amount is never believed without independent confirmation |
| `observability/` | Structured logging with redaction, and metrics | Evidence that survives an incident |
| `__checks__/` | The 397 automated checks and the demo-flag harness | Every claim in the report is tied to a test here |

---

## 3. The security modules, one by one

These live in `backend/src/security/` and are the pieces the report's Section 5 refers to.

| File | What it does | Without it |
|---|---|---|
| `http-security.ts` | Security headers, the cross-origin allowlist, and CSRF tokens bound to the session | Any website could make requests as a signed-in shopper and read the replies |
| `crypto.ts` | One AES-256-GCM wrapper, a separate key per purpose, a keyed index for searchable email | A copy of the database would reveal every phone number and address |
| `safe-fetch.ts` | Checks any outbound URL: allowlisted host, resolved to a public address, connection pinned | The server could be told to fetch cloud credentials or reach internal services |
| `sanitise.ts` | Cleans user-written text on save, keeping formatting and discarding anything active | A script in a review would run for every visitor |
| `rate-limit.ts` | Counters in Redis, per address and per account, that cannot be raced | Passwords could be guessed at speed, and rotating addresses would defeat the limit |
| `demo-flags.ts` | Switches that turn a single control off, gated so they can never run in production | Controls could only be asserted, never demonstrated failing |

Two more sit just outside that folder and matter as much:

- **`authz/policy.ts`** answers *may this actor do this action to this resource?* and returns
  false unless something explicitly allows it. New routes are therefore safe by default.
- **`middlewares/error-handler.middleware.ts`** returns a short generic message with a tracking id
  and nothing else. Stack traces and database errors stay in the logs where an operator can use
  them and an attacker cannot.

---

## 4. Data stores, and why there are three

| Store | Port | Holds | Why this one |
|---|---|---|---|
| **PostgreSQL 17** | `55433` | Products, orders, users, addresses, payments, reviews | Row-Level Security enforces ownership inside the database, so a query that forgets a filter still returns nothing. Constraints make invalid states impossible: a negative total or negative stock cannot be written at all. |
| **Redis 7** | `56379` | Sessions and rate-limit counters | Counters must be atomic. A limiter that can be raced is not a limiter, and Redis increments cannot interleave. |
| **MongoDB 7** | `57017` | The activity log only | Kept deliberately so that NoSQL injection remains a demonstrable class in a system that is otherwise relational. |

**Three database roles, not one.** The application connects as `app_rw`, which can read and write
rows but cannot change the schema and has a five second statement timeout. `app_ro` can only read.
`migrator` owns the schema and is never exposed to the network. If the application were fully
compromised, it still could not drop a table.

---

## 5. Outbound services

| Service | Used for | The control that matters |
|---|---|---|
| **eSewa** (ePay v2) | Payment in Nepali Rupees | The server calculates the amount, signs it, and after the shopper returns it asks eSewa directly to confirm the payment and compares the figure against the stored total. A returned status is never believed on its own. |
| **Stripe** | Card payment | The card page is hosted by Stripe, so card numbers never reach this system. The webhook is signature-verified before its body is parsed. |
| **OpenAI** (`gpt-4o-mini`) | Product copy for admins, catalogue answers for shoppers | The model id is pinned in configuration, no tools are granted so it cannot change a price or an order, and its output is stripped of links and images before display. |

All three are reached **outbound only**. Nothing from them can start a request into the system
except the Stripe webhook, which is verified before it is trusted.

---

## 6. The monitoring and detection stack

Started with `docker compose --profile detection up -d`.

| Service | Port | What it is for | Status here |
|---|---|---|---|
| **Prometheus** | `9090` | Collects numbers over time: request rates, error rates, rate-limit trips, failed logins, AI spend. Answers "is something happening more than usual". | Running, scraping the API |
| **Grafana** | `3000` | Draws those numbers, and searches the logs. The place an operator actually looks. | Running |
| **Loki** | internal | Stores the application logs so they can be searched by correlation id, which links the generic error a user saw to the full detail. | Running |
| **Promtail** | internal | Ships logs from disk into Loki. | Running |
| **Wazuh** | internal | Correlates the application audit trail and host events into alerts, for example repeated authorization failures from one session. | Running |
| **Suricata** | internal | Network intrusion detection. Inspects packets against 52,000 signatures. Traffic from the API to an internal address is what a successful SSRF looks like on the wire. | Running |

**What is not here.** Falco was configured to watch syscalls inside the containers, but it has
never run on this host. It loads its rules and then dies at `scap_init` because its kernel probe
cannot attach to the WSL2 kernel. It has been removed from the report rather than described as a
control, and the compose service is left in the `runtime` profile for a Linux host.

### The metrics worth looking at

```
http_requests_total          requests by method, route and status
http_request_duration_seconds  latency
rate_limit_tripped_total     how often the limiter refused someone
auth_login_failure_total     failed sign-in attempts
ai_tokens_spent_total        AI cost, which is also a denial-of-wallet signal
```

---

## 7. The edge, and the container itself

| Piece | Purpose |
|---|---|
| **nginx 1.30.4 with libmodsecurity 3.0.16 and OWASP CRS 4.28.0** (`app` profile) | Terminates TLS, allows only known host names, and filters obviously hostile requests before they reach the application. Deliberately set to a low paranoia level so that the *application's* controls are what is under test. |
| **Distroless runtime image** | The image contains no shell, the filesystem is read-only, privileges are dropped and resources are capped. This does not prevent a bug; it limits what a bug can do. |

---

## 8. Commands

```bash
# data services only, which is what `npm run dev` needs
docker compose up -d

# plus the monitoring and detection stack
docker compose --profile detection up -d

# the whole thing in containers, behind nginx
docker compose --profile app up -d
```

```bash
cd backend
npm run dev            # API on http://localhost:8000
npm run seed:all       # reset to known data (see accounts below)
npm run typecheck      # compiler, no emit

npm run verify         # 174 offline checks
npm run verify:live    # 213 checks against a real database and API
npm run demo:pairs     # 10 controls, each proven secure AND broken
```

```bash
cd client
npm run dev            # application on http://localhost:5173
npm run build          # production build
```

**Note:** `verify:live` and `demo:pairs` empty the database. Run `npm run seed:all` afterwards
before taking screenshots.

### Accounts

All share the password `Nepal@Shop2026!`

| Account | Role | Use for |
|---|---|---|
| `admin@shop.test` | ADMIN | Admin panel, uploads, AI copy |
| `sunita@shop.test` | USER | The "victim" in access-control tests |
| `bibek@shop.test` | USER | The "attacker" in access-control tests |
| `aarati@`, `prakash@`, `manisha@` | USER | Additional customers with order history |

### Where things listen

| What | Address |
|---|---|
| Application | http://localhost:5173 |
| API, development server | http://localhost:8000 |
| API, containerised, behind nginx and ModSecurity | http://localhost:8080 |
| Grafana | http://127.0.0.1:3000/d/blitzy-security, user `admin`, password from `GRAFANA_PW` in `.env` |
| Prometheus | http://127.0.0.1:9090 |
| Wazuh dashboard | http://127.0.0.1:5601, no login |
| PostgreSQL / Redis / MongoDB | `127.0.0.1:55433` / `56379` / `57017` |

Everything except the application and the nginx edge binds to loopback only, so nothing is
reachable from the network. The Wazuh indexer and the Wazuh API publish no port at all and are
reachable only from inside the Docker network.

**Use 8080 for anything that should show up in the monitoring stack.** Port 8000 is the
development server on the host. Only the containerised path passes through nginx, is seen by
Suricata, and lands in the log file Wazuh reads.

### If the Wazuh volumes are ever recreated

The dashboard talks to the manager as `wazuh-wui`, and a fresh manager ships that account with a
default password the dashboard config does not use. One command lines them up again:

```bash
docker compose exec -T wazuh sh -c '
T=$(curl -sk -u "${WAZUH_ADMIN_USER}:${WAZUH_ADMIN_PASSWORD}" \
  -X POST https://localhost:55000/security/user/authenticate \
  | sed -n "s/.*\"token\": *\"\([^\"]*\)\".*/\1/p")
curl -sk -X PUT "https://localhost:55000/security/users/2" \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"password\":\"${WAZUH_API_PASSWORD}\"}"
'
```

Without it the dashboard loads but every Wazuh module reports that the API is unreachable.

The *Blitzy security events* dashboard lives in the indexer, not on disk, so a recreated volume
loses it. It is exported to the repository. Import it back with:

```bash
curl -s -X POST "http://localhost:5601/api/saved_objects/_import?overwrite=true" \
  -H "osd-xsrf: true" -F "file=@infra/detection/wazuh/blitzy-dashboard.ndjson"
```

That brings back the `wazuh-alerts-*` index pattern, five visualisations, the saved search and
the dashboard itself.

---

## 9. How a single request travels

Worth reading once, because it explains why the pieces are arranged this way.

1. The browser sends a request with its session cookie and, for anything that changes data, a CSRF
   token bound to that session.
2. **nginx** terminates TLS, checks the host name and applies generic filtering.
3. The **API** rejects the request outright if its framing is ambiguous, before any parser runs.
4. The body is checked against a **strict schema**. An unknown field is an error, not something
   quietly ignored, which is what stops hidden parameters.
5. **Identity** is resolved only from the session, and the user record is re-read, so a ban or a
   role change takes effect on this very request.
6. The **policy** decides whether this actor may perform this action. A refusal answers 404, which
   does not reveal whether the record exists.
7. **Rate limits, CSRF and origin** are checked.
8. The **handler** runs a query scoped to the owner, and **Row-Level Security** applies the same
   ownership rule independently inside the database.
9. Money, if any, is **recomputed from the database**, never taken from the request.
10. The outcome is written to the **audit trail**, and counters go to **Prometheus** while the log
    line goes to **Loki**, both carrying the correlation id.

A failure at any step stops the request, and no single step is the only thing standing between an
attacker and the data.
