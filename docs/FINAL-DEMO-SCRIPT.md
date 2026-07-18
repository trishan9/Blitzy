# The demonstration, ten minutes

Everything to do, every payload, and every spoken line. In order.

The narration as written measures about **10.8 minutes** at reading pace. Dropping the two
beats marked OPTIONAL brings it under ten. The trim list near the end says what goes next.

`DO` is an action. `SAY` is narration written to be read aloud. `RUN` is a command to paste into
a terminal that is on screen.

| Time | Part | Subject |
|---|---|---|
| 0:00 | 1 | The application, fast |
| 0:45 | 2 | The controls in the source, one line each |
| 2:00 | 3 | Postman, the controls answering |
| 4:00 | 4 | Burp Suite, attacking it by hand |
| 7:00 | 5 | Prometheus, Grafana, Loki, Wazuh, Suricata |
| 9:15 | 6 | The pipeline and the harness |

The argument: the application is ordinary, the controls hold under real attack, and when someone
attacks it the monitoring stack says so on its own.

---

# Part 0. Setup, before you press record

```bash
bash scripts/up.sh                     # 13 containers, waits, prints every port
cd client && npm run dev               # separate terminal, must be 5173
bash scripts/burp-requests.sh          # writes docs/burp/*.txt with live cookies and ids
bash scripts/demo-data.sh quick        # ~2 min, gives the graphs a shape
bash scripts/demo-security-events.sh   # ~4 min, seven Wazuh rules from real attacks
bash scripts/up.sh check               # all six addresses 200, alerts well above twenty
```

**Postman.** Import both files, pick **blitzy local** in the environment dropdown, set
Settings → General → **Automatically follow redirects: off**, then run the folder
**`1 Setup, run this folder first`**.

```
docs/postman/blitzy.postman_collection.json
docs/postman/blitzy-local.postman_environment.json
```

**Burp.** Settings → Tools → Proxy → edit the `127.0.0.1:8080` listener → port **8081**. Burp's
default collides with the nginx edge, and if you skip this every request you send to 8080 is
answered by Burp instead of nginx.

**Browser.** Signed in as sunita, with **one item in the cart**. Part 4 needs a non-empty cart.

**Terminal.** One window, already in the project root, font large enough to read.

---

# Part 1. The application, 45 seconds

> **SAY**
> This is Blitzy, a quick-commerce grocery application for Nepal. React in the browser, one
> Express API, PostgreSQL, Redis and MongoDB behind it, and nginx with the OWASP core rule set in
> front. Built from nothing with security as the design rather than as a review afterwards.

**DO** — `http://localhost:5173`. Scroll the catalogue, open a product, open the cart, place an
order with cash on delivery.

> **SAY**, while it places
> The browser just sent an address id and a payment method. No price, no total. It could not have
> sent one, because the request type has no field for money in it.

> **SAY**
> Ordinary so far, and that is the point.

---

# Part 2. The controls in the source, 75 seconds

Do not explain any of these. Open the file, let the line sit for three seconds, say the one line,
move on. Twenty one stops, about three seconds each. Every line number below was checked.

**Setup:** `Ctrl+B` to hide the sidebar, zoom in twice, keep the file tab and the line numbers in
frame. `Ctrl+P` and paste the path, then `Ctrl+G` and the number.

> **SAY**, as the first file opens
> Every vulnerability class in the report has a place in this code where it is prevented. Here
> they are, one at a time.

| # | Vulnerability | Open | Say |
|---|---|---|---|
| 1 | SQL injection | `catalog/product-query.ts` **23** | the sortable columns are a fixed map |
| 2 | " | same file **48** | the client sends a key, the server looks up the column. Nothing is interpolated |
| 3 | NoSQL injection | `activity/activity-log.ts` **100** | the Mongo filter is built from scalars, so no object from a client reaches the driver |
| 4 | Stored XSS | `security/sanitise.ts` **37** | attacker-authored text is parsed and cleaned on write, not regex-stripped |
| 5 | CORS | `security/http-security.ts` **34** | exact set membership. An origin that was not allowed is never echoed back |
| 6 | CSRF | same file **134** | a signed double-submit token, bound to the session |
| 7 | SSRF | `security/safe-fetch.ts` **61** | cloud metadata denied by name, and every private range denied by classification |
| 8 | Broken access control | `authz/policy.ts` **74** | may this actor do this to this resource. Every branch ends in false |
| 9 | Enumeration | same file **177** | and a denial is a 404, because a 403 confirms the thing exists |
| 10 | Brute force | `security/rate-limit.ts` **52** | two buckets. One per address, one per account. Neither alone is enough |
| 11 | JWT tampering | `auth/jwt-verify.ts` **34** | verified against this system's own key set only. A token never names its own key |
| 12 | Weak password storage | `auth/argon2.ts` **25** | Argon2id at the parameters OWASP recommends |
| 13 | Malicious upload | `uploads/image-pipeline.ts` **27** | the leading bytes decide the type, not the claimed one, and every image is re-encoded |
| 14 | Path traversal | `routes/secure/uploads.route.ts` **216** | the key has to match a pattern, and it is looked up, never joined onto a path |
| 15 | Price tampering | `checkout/checkout.ts` **41** | the checkout input has no money field at all |
| 16 | Race condition, oversell | same file **228** | the stock condition is inside the update. Never read then write |
| 17 | Information disclosure | `middlewares/error-handler.middleware.ts` **59** | one place decides what leaves. The client gets a message and an id |
| 18 | Command injection | `invoices/invoice-pdf.ts` **21** | invoices are built in process. No shell, no HTML renderer |
| 19 | CSV formula injection | `exports/csv.ts` **19** | a cell that starts with an equals sign is a formula, so every cell is prefixed |
| 20 | Data at rest | `security/crypto.ts` **108** and **180** | one audited wrapper, and a keyed index so encrypted fields are still searchable |
| 21 | LLM exfiltration | `ai/output-guard.ts` **37** | markdown images and links are stripped, because the browser fetches them on render |
| 22 | Prompt injection | `ai/injection-scanner.ts` **52** | the question is scanned, and so is every retrieved chunk |
| 23 | Query forgets a filter | `db/migrations/0001_force_rls_and_grants.sql` **22** | row-level security, forced, so the database enforces ownership even if the query does not |

All paths are under `backend/src/`.

> **SAY**, to close the montage
> None of that is a review finding written up afterwards. It is the shape the code was written in.
> The rest of this is proving it holds.

---

# Part 3. Postman, 2 minutes

> **SAY**
> Every request from here is real, against the running system. Nothing is mocked.

### 3.1 SQL injection

**DO** — `3 Attacks → SQL injection in the sort parameter` → **Send**

```
GET {{base}}/products?sort=(SELECT CASE WHEN (1=1) THEN name END)
```

> **SAY**
> Four hundred, invalid query. Sorting is an allowlist of column names, so that value is never
> interpolated into a statement at all.

**DO** — `3 Attacks → The valid sort, for contrast` → **Send**

> **SAY**
> The same parameter used properly. Two hundred, cheapest first. The endpoint works, it just will
> not take anything outside the list.

### 3.2 Reading another customer's order

**DO** — `3 Attacks → One customer reading another customer's order` → **Send**

> **SAY**
> Bibek asking for one of Sunita's orders, with a real order id and a valid session of his own.
> Four hundred and four. Not forbidden. Not found. He learns nothing, not even that it exists.
> Every denial in this system is a 404, because a 403 confirms the resource is there.

**DO** — `3 Attacks → An admin route as a normal customer` → **Send**

> **SAY**
> Same on an admin route. The interface hides the admin menu from customers, but that is only a
> convenience. The server refuses it regardless of what the interface shows.

### 3.3 Cross-site request forgery

**DO** — `2 Evidence → A write with no CSRF token is refused` → **Send**

> **SAY**
> A write with a valid session and no token. Four hundred and three.

**DO** — `2 Evidence → The same write with a token succeeds` → **Send**

> **SAY**
> Identical request, one header added, two hundred. The token is signed and bound to the session,
> so another site cannot get one.

### 3.4 The session cookie and the headers

**DO** — `1 Setup → Sign in as sunita` → **Headers** tab → expand `Set-Cookie`

> **SAY**
> Four things on that cookie. HttpOnly, so a scripting flaw has nothing to read. Secure. SameSite.
> And the host prefix, which forbids a domain attribute, so a subdomain cannot set it.

**DO** — `2 Evidence → Security headers on every response` → **Headers** tab

> **SAY**
> Content security policy with a nonce, strict transport security, no-sniff, referrer policy, and
> no version on the server header. Every response, not just the pages.

### 3.5 The error handler

**DO** — `3 Attacks → A malformed body, for the error handler` → **Send**

> **SAY**
> Four hundred, a short message and a correlation id. No stack trace, no table name, no library
> version.

**DO** — **copy the `correlationId`.** Part 5 needs it.

### 3.6 Rate limiting

**DO** — **Runner** → tick only `4 Rate limiting` → **11 iterations** → delay 0 → **Run**

> **SAY**
> Eleven sign-in attempts with the wrong password. Three answered, the rest refused. Three
> attempts every ten seconds, counted in Redis so restarting the server does not clear it.

---

# Part 4. Burp Suite, 3 minutes

Paste each payload into a Repeater tab: **+** for a new tab, click the request pane, `Ctrl+A`,
`Ctrl+V`, **Send**. Burp recalculates `Content-Length` on send, so never count characters.

> **SAY**
> Postman shows the controls answering. Burp is where requests get shaped by hand, which is what
> an attacker actually does.

### 4.1 The edge, and the same payload refused twice

nginx has no screen of its own, so it is shown by what it refuses.

**DO** — paste and Send:

```http
GET /api/products?sort=(SELECT%20CASE%20WHEN%20(1=1)%20THEN%20name%20END) HTTP/1.1
Host: localhost:8080
Origin: http://localhost:5173
Connection: close


```

> **SAY**
> Four hundred and three. And this one did not come from the application. It came from
> ModSecurity, the web application firewall in front of it, and the application never saw the
> request at all.

**RUN**
```bash
docker compose logs nginx --since 2m | grep ModSecurity | tail -1
```

> **SAY**
> Three things in that line are worth reading out. Phase two, so the decision was made after the
> request was parsed and before anything was proxied. An anomaly score of twenty against a
> threshold of five, because the core rule set scores a request rather than matching a single
> rule. And the version, OWASP core rule set four point two eight, printed by the product itself
> rather than claimed by me.

**DO** — in the same Repeater tab change `Host: localhost:8080` to `Host: localhost:8000`, set
the target in the top right to port **8000**, Send

> **SAY**
> The same payload sent straight at the application, past the firewall. Four hundred, invalid
> query. The sort parameter is an allowlist of column names, so that value was never going to
> reach a statement.
>
> Two layers, two different answers, and that is the whole argument for defence in depth. The
> firewall catches what looks like an attack. The application catches what is one. The rule set
> runs at its lowest paranoia setting on purpose, because the application is what is under test.
> A determined encoding is meant to slip past the edge, and be refused anyway.

### 4.1b Three more things the edge refuses — OPTIONAL

Twenty seconds, one terminal, four commands. This is the first thing to cut if you are
running long. Part 4.1 already makes the edge's case on its own.

**RUN**
```bash
curl -s -o /dev/null -w "unknown host  -> %{http_code}\n" -H "Host: evil.test" http://localhost:8080/api/products
curl -s -o /dev/null -w "TRACE         -> %{http_code}\n" -X TRACE http://localhost:8080/
curl -s -o /dev/null -w "metrics, edge -> %{http_code}\n" http://localhost:8080/metrics
curl -s -o /dev/null -w "metrics, app  -> %{http_code}\n" http://localhost:8000/metrics
```

Expect `000`, `405`, `404`, `200`.

> **SAY**
> A request for a host this server does not serve gets no reply at all, not even an error. TRACE
> is refused outright. And the metrics endpoint answers on the application but four oh fours
> through the edge, which is the pair worth pausing on. The endpoint exists. It is not published.
> That is a decision, not an absence.

**DO** — optional, if you want the versions on screen

**RUN**
```bash
docker compose exec nginx nginx -v
docker compose exec nginx grep ^SecRuleEngine /etc/modsecurity.d/modsecurity.conf
```

> **SAY**
> nginx one point thirty point four, and the rule engine is On rather than DetectionOnly, so it is
> blocking rather than watching.

### 4.2 CORS

**DO** — paste, Send, open the response **Headers**:

```http
GET /api/products HTTP/1.1
Host: localhost:8080
Origin: https://evil.test
Connection: close


```

> **SAY**
> A request claiming to come from a site that is not on the allowlist. Look at the response
> headers. There is no cross-origin permission header at all, so a browser will refuse to hand
> that body to the page.

**DO** — change the origin to `http://localhost:5173`, Send, show the headers again

> **SAY**
> The allowed origin gets one. So the header is being decided, not left out by accident. The
> mistake people make here is reflecting whatever origin was asked for, which quietly allows every
> site at once.

### 4.3 Path traversal

**DO** — paste and Send:

```http
GET /api/uploads/../../../../etc/passwd HTTP/1.1
Host: localhost:8080
Origin: http://localhost:5173
Connection: close


```

> **SAY**
> Four hundred and four. Uploads are served through an authorised route rather than a static
> directory, and the key is looked up rather than joined onto a path.

### 4.4 Price tampering, both halves

The most important ninety seconds in the recording.

**DO** — open `docs/burp/14-price-tampering-400.txt`, paste it whole, Send. The body is:

```json
{"addressId":"<a real id, filled in by the script>","paymentMethod":"CASH_ON_DELIVERY","totalPaisa":1}
```

> **SAY**
> A checkout with a total of one paisa added to the body. Four hundred, invalid request body. The
> schema is strict, so an unknown field is not ignored, it is a rejection.

**DO** — delete `,"totalPaisa":1` from the body, Send

> **SAY**
> The same request without it goes straight through. So that four hundred was about the money
> field and nothing else.

**DO** — restart the backend with exactly one control removed, then resend the original

**RUN**
```bash
cd backend
DEMO_MODE=true TRUST_CLIENT_TOTAL=true npm run dev
```

> **SAY**
> Now the byte-identical request against a build with one control turned off. Two hundred and one.
> An order for one paisa. That is what the vulnerability looks like when it is present, and it is
> the only honest way to show a control is doing something.

**DO** — stop it, restart normally, show the boot banner reporting zero active flags

**RUN**
```bash
npm run dev
```

### 4.5 Brute force with Intruder

**DO** — paste this into Repeater and Send once to confirm 401:

```http
POST /api/auth/sign-in/email HTTP/1.1
Host: localhost:8080
Origin: http://localhost:5173
Content-Type: application/json
Connection: close

{"email":"sunita@shop.test","password":"wrong-password"}
```

**DO** — `Ctrl+I` → **Positions** → **Clear §** → select only `wrong-password` → **Add §** →
attack type **Sniper**

```
{"email":"sunita@shop.test","password":"§wrong-password§"}
```

**DO** — **Payloads** → type **Simple list** → paste this list → **Start attack**

```
password
password1
Password1
123456
12345678
qwerty
letmein
admin
admin123
welcome
welcome1
iloveyou
monkey
dragon
football
abc123
sunita
sunita123
Nepal123
nepal2026
Kathmandu1
blitzy
blitzy123
shop123
changeme
```

> **SAY**, while it runs
> Every one of those is wrong on purpose. Burp Community sends about one a second, which is useful
> here because the limit is three every ten seconds, so the window rolls several times during the
> run.

**DO** — when it finishes, sort back to attack order, show the **Status** and **Length** columns

> **SAY**
> Bands, not one wall. Three get through, the rest are refused, the window rolls, three more get
> through. Twenty five guesses bought nine real attempts. And every four hundred and one is the
> same length, so nothing here tells an attacker whether that account exists.

---

# Part 5. The monitoring, 2 minutes 15

> **SAY**
> Preventing an attack and noticing one are different problems. Everything in the last six minutes
> left a trace, and this is where the traces went.

### 5.1 Prometheus, http://localhost:9090

**DO** — `/targets`

> **SAY**
> Three scrape targets, all up.

**DO** — `/query`, paste each and Execute

| Paste | Say while it renders |
|---|---|
| `auth_login_failure_total` | the counter the Intruder run just moved. Pick the `api:8000` series |
| `sum by (status) (http_requests_total)` | two hundreds beside four hundreds, four oh ones, four oh fours and four two nines |

> **SAY**
> That other instance reads zero. It is the development server, and it is a useful reminder that
> only the containerised path is being watched.

### 5.2 Grafana, http://localhost:3000/d/blitzy-security

Login `admin`, password from `GRAFANA_PW` in `.env`. Time picker **Last 1 hour**, refresh **10s**.

> **SAY**
> The same series over time. Request rate, requests by status, failed sign-ins, error responses,
> latency at the ninety fifth percentile. Provisioned from the repository, so the dashboard is
> part of the project rather than something clicked into a container.

### 5.3 Loki, the best shot in the recording

**DO** — `http://localhost:3000/explore`, pick **Loki**, run:

```
{container="/blitzy-api-1"}
```

**DO** — paste the correlation id from Part 3.5:

```
{container="/blitzy-api-1"} |= "PASTE-THE-CORRELATION-ID"
```

> **SAY**
> This is the request Postman made. The client got four words and an identifier. The log has the
> method, the path, the actor, the full error and the stack. Same event, two audiences, joined by
> that id. Full detail for whoever has to investigate, nothing for whoever is probing.

### 5.4 Wazuh, http://localhost:5601/app/dashboards

**DO** — open **Blitzy security events**, time picker **Last 24 hours**

> **SAY**
> These are alerts, not log lines. Rules written for this application, over the events it emits.
> The table names each one that fired: repeated login failures, authorization denied, token
> verification failure, blocked outbound fetch, prompt injection, rejected upload. Every one of
> them came from a real request.

**DO** — expand one row of rule **100010**, scroll to `previous_output`

> **SAY**
> And this is why correlation matters rather than alerting on single events. One failed sign-in is
> noise, so that rule is level three and stays quiet. Eight inside two minutes is level ten, and
> the alert carries the eight lines that triggered it with it.

### 5.5 Suricata

**RUN**
```bash
docker compose exec suricata sh -c 'grep "rules successfully loaded" /var/log/suricata/suricata.log | tail -1'
docker compose exec suricata sh -c 'grep "\"event_type\":\"alert\"" /var/log/suricata/eve.json | tail -1'
```

> **SAY**
> Fifty two thousand signatures on the wire, and a real alert. Worth saying how that was fixed.
> The sensor originally sat on a Docker bridge with its own address, and a bridge switches frames
> point to point rather than repeating them, so it saw sixty four packets in twelve minutes, all
> of it ARP. Moving it into the application's own network namespace is what made it see anything.

---

# Part 6. The pipeline and the harness, 45 seconds

**DO** — open [.github/workflows/ci.yml](../.github/workflows/ci.yml)

> **SAY**
> Five jobs on every push and every pull request. Secret scanning across the whole history, static
> analysis, a dependency vulnerability check, the project's own suite against ephemeral services,
> and a container image scan that fails on anything high or critical, with a software bill of
> materials as an artifact. Four of them can stop a change being accepted.

**DO** — run the project's own gate locally so it is not just a file on screen

**RUN**
```bash
cd backend && npm audit --omit=dev
```

> **SAY**
> The dependency check, over the packages this API actually ships with. Five moderate findings and
> nothing high or critical, which is worth saying out loud rather than glossing over. The gate in
> the pipeline fails on high and critical, so this passes, and the moderates are tracked rather
> than hidden.

**RUN**
```bash
cd backend && npm run demo:list
```

> **SAY**
> Twenty three demo flags, every one off. The application refuses to start with any of them set
> unless it is explicitly in demo mode outside production.

**RUN**
```bash
cd backend && npm run demo:pairs
```

> **SAY**
> And this is what keeps the whole thing honest. For every control it asserts two things. That the
> attack fails when the control is on, and that the same attack succeeds when the flag turns it
> off. A control that cannot be shown to break has not been shown to work.
>
> One application, built secure from the start rather than tested afterwards. Every control
> exercised through Postman and Burp, proved by turning it off, and watched by a stack that raised
> real alerts from real attacks.

**Afterwards**, because `demo:pairs` empties the order tables:

```bash
cd backend && npm run seed:all
```

---

# If you are running long

The narration alone is about nine minutes, so there is very little slack. Cut in this order:

1. Part 4.1b, the three extra edge refusals. Part 4.1 already makes the point
2. Part 4.3, path traversal. The montage already showed it and it costs fifteen seconds
3. Part 3.4, the security headers half. Keep the cookie half
4. Part 5.5, Suricata. Say the sentence over the Wazuh screen instead of switching to a terminal
5. Part 2, drop rows 19, 20 and 22 from the montage. Twenty one stops is already brisk

Do not cut Part 4.4. It is the only place a control is shown failing.

---

# Three things that will cost you a retake

**Copy the correlation id in Part 3.5** before you need it in Part 5.3. Going back for one breaks
the flow.

**Do the Intruder run before Part 5.** It is what makes the Prometheus counter climb and the Wazuh
brute-force rule fire.

**Run `demo:pairs` last.** It truncates the order tables, so anything filmed after it shows an
empty shop.

---

# About the pipeline on GitHub

The remote on this clone points at the upstream template repository, so there are no Actions runs
under your account to show. Two honest options:

1. Push to a fork of your own and let the five jobs run, then film the green run
2. Film the workflow file and run one scanner locally, as Part 5 does

The second is what the script assumes. Say which one you did rather than implying a run happened.

---

# If something goes wrong mid-recording

| Symptom | Fix |
|---|---|
| A Burp request returns 401 or 403 | the session or token went stale. `bash scripts/burp-requests.sh`, paste the fresh file |
| Postman returns 403 on a write | check the environment dropdown still says **blitzy local**, re-run folder `1 Setup` |
| Every sign-in returns 429 | three attempts per ten seconds. Wait fifteen seconds |
| The shop errors on every call | the client is on 5174. Only 5173 is allowed by CORS |
| A Prometheus graph is flat | you are on the `host.docker.internal:8000` series. Click `api:8000` |
| Grafana or Wazuh panels empty | widen the time picker, then `bash scripts/demo-security-events.sh` |
| Wazuh asks for a login | `docker compose --profile app --profile detection up -d --force-recreate wazuh-dashboard` |
| Anything else | `bash scripts/up.sh` and read the table |
