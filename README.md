# Blitzy

A quick commerce grocery shop for Nepal, built from nothing with security as the design rather
than as a review afterwards.

---

## What this is, in plain words

Blitzy is an online grocery shop. You browse food, put it in a basket, choose an address, pay, and
track the order until it arrives. Shop staff have their own area where they add products, watch
orders come in, and move each one along from paid to packed to delivered.

That part is ordinary. The reason this project exists is the other half.

Most software gets built first and checked for security later. This one was built the other way
round. Every place where an online shop usually goes wrong was decided up front, written into the
code, and then attacked on purpose to prove the decision holds. On top of that sits a set of tools
that watch the running system and raise an alarm by themselves when somebody attacks it.

So there are three things in this repository:

1. A working shop
2. The security built into it, in the source rather than in a document
3. A monitoring stack that notices attacks while they happen

### A few things it will not let you do

- You cannot change the price of anything. The browser never sends a price at all, so there is
  nothing to change.
- You cannot read somebody else's order. If you try, the answer is "not found", which does not
  even confirm the order exists.
- You cannot guess a password quickly. Three tries every ten seconds, then it stops answering.
- You cannot upload a program disguised as a photo. The file is checked by its actual contents and
  then rebuilt as a fresh image.
- You cannot trick the shopping assistant into leaking its instructions. The question is inspected
  before the model ever sees it.

---

## Running it

You need Docker Desktop and Node.js 22.

```bash
bash scripts/up.sh          # starts everything and prints every port with its status
cd client && npm run dev    # the shop itself, in a second terminal
```

`scripts/up.sh check` reports the state without starting anything.

### Where things live

| What | Address |
|---|---|
| The shop and the staff area | http://localhost:5173 |
| The API, behind the firewall | http://localhost:8080 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 |
| Wazuh console | http://localhost:5601 |

Only the shop and the API edge are reachable from the network. Everything else is bound to this
machine only. The database, the cache, and the log store publish nothing at all and can be reached
only from inside the private Docker network.

### Test accounts

All use the password `Nepal@Shop2026!`

| Account | Role |
|---|---|
| `admin@shop.test` | staff |
| `sunita@shop.test` | customer |
| `bibek@shop.test` | second customer |

---

## How it is built

| Layer | Choice |
|---|---|
| Browser | React 19, Vite 7, Tailwind, shadcn/ui |
| API | Express 5 on TypeScript, Node 22 |
| Main database | PostgreSQL 17 with Drizzle |
| Sessions and counters | Redis 7 |
| Activity log | MongoDB 7 |
| Edge | nginx 1.30.4 with ModSecurity and OWASP Core Rule Set 4.28.0 |
| Identity | Better Auth with Argon2id, passkeys, two factor, OAuth |
| Payments | eSewa ePay v2 and Stripe |
| Assistant | OpenAI, pinned model, no tools granted |

The browser talks to one API. That API is the only place that decides who may do what. Behind it
sit the three data stores, and beside it the monitoring stack. Everything runs in Docker so the
same setup rebuilds on any machine.

The rule the whole design follows is short. **The browser is assumed to belong to an attacker.**
Nothing it sends is trusted, and nothing it is told is relied upon.

---

## The security, control by control

Every item below is in the source. The file is given so it can be read rather than taken on trust.
All paths are under `backend/src/`.

### Money and stock

| Problem | Where it is solved |
|---|---|
| Changing the price at checkout | `checkout/checkout.ts`. The checkout input has an address, an optional coupon code, and a payment method. There is no field for money, so tampering is not rejected, it is impossible to express |
| Two people buying the last item | `checkout/checkout.ts`. Stock is reduced by an update that carries its own condition, so two transactions cannot both pass it. The whole checkout is one serializable transaction with retry, and a database constraint makes negative stock unrepresentable |
| Paying less than the order is worth | `payments/esewa.ts`. The amount is signed by the server, and after the customer returns the server asks the payment provider directly to confirm it, then compares against the stored total |

### Who may do what

| Problem | Where it is solved |
|---|---|
| Reading or changing another person's data | `authz/policy.ts`. One function answers whether an actor may do an action to a resource. Every branch ends in false, so anything not explicitly allowed is refused |
| Learning that something exists by being refused | `authz/policy.ts`. A denial is a 404, never a 403, and the message is the words "not found" |
| Guessing hidden routes with header tricks | `authz/authorize.ts`. Routing override headers are ignored, so a path based check cannot be bypassed |
| A query that forgets its ownership filter | `db/migrations/0001_force_rls_and_grants.sql`. Row level security is not only enabled, it is forced. The database itself refuses to return another customer's rows. Three database roles exist, and the application connects as one that cannot change the schema |

### Getting in

| Problem | Where it is solved |
|---|---|
| Weak password storage | `auth/argon2.ts`. Argon2id at the parameters OWASP recommends |
| Password guessing | `security/rate-limit.ts`. Two counters, one per address and one per account, held in Redis so they are atomic and survive a restart |
| Stolen or forged tokens | `auth/jwt-verify.ts`. Tokens are checked against this system's own key set only. A token that names its own key is never believed |
| A session that should have ended | `middlewares/auth.middleware.ts`. Every request confirms the account is still active and the token generation still current |
| Cookie theft by a script | The session cookie is HttpOnly, Secure, SameSite, and carries the host prefix, so no script can read it and no subdomain can set it |

### Input and output

| Problem | Where it is solved |
|---|---|
| SQL injection | `catalog/product-query.ts`. Sortable columns are a fixed map. The client sends a key, the server looks up the column, and nothing is ever pasted into a statement |
| NoSQL injection | `activity/activity-log.ts`. The Mongo filter is built from plain values, so no object from a client reaches the driver |
| Scripts stored in reviews | `security/sanitise.ts`. Attacker written text is parsed and cleaned when it is saved, not stripped with a pattern |
| Requests from other websites | `security/http-security.ts`. A signed token tied to the session, plus an origin allowlist checked by exact match |
| Errors that reveal the internals | `middlewares/error-handler.middleware.ts`. One place decides what leaves. The caller gets a short message and a tracking id, and the stack stays in the log |

### Files and outbound requests

| Problem | Where it is solved |
|---|---|
| A program uploaded as a photo | `uploads/image-pipeline.ts`. The leading bytes decide the type, not the name or the claim, and every image is decoded and written out again, which destroys files that are valid as two things at once |
| Escaping the upload folder | `routes/secure/uploads.route.ts`. The key must match a pattern and is looked up, never joined onto a path |
| Making the server fetch internal addresses | `security/safe-fetch.ts`. The name is resolved first and the result must be a public address, so private and loopback ranges are refused by classification rather than by a list. Redirects are not followed |
| Command injection while making an invoice | `invoices/invoice-pdf.ts`. Invoices are built in process. No shell, no page renderer |
| A spreadsheet formula hidden in an export | `exports/csv.ts`. A cell starting with an equals sign is a formula to a spreadsheet, so every cell is prefixed |

### Data at rest and the assistant

| Problem | Where it is solved |
|---|---|
| A stolen database copy | `security/crypto.ts`. One audited wrapper over AES-256-GCM, a separate key per purpose, and a keyed index so encrypted fields can still be searched |
| The assistant being talked into misbehaving | `ai/injection-scanner.ts`. The question is scanned, and so is every piece of retrieved text, because indirect attacks hide in the data rather than the question |
| The assistant leaking data through a link | `ai/output-guard.ts`. Images and links are removed from model output, because a browser fetches them the moment it draws them |

---

## Proving it, rather than claiming it

Every control has a switch that turns it off. The test suite checks both halves: the attack fails
while the control is on, and the same attack succeeds once the switch is thrown. A control that
cannot be shown to break has not been shown to work.

```bash
cd backend
npm run demo:list     # all 23 switches, every one off
npm run demo:pairs    # each control held, then broken
npm run verify        # 174 checks with nothing else running
npm run verify:live   # the rest, against real services
```

The switches refuse to load unless the app is explicitly in demo mode outside production, so they
cannot reach a deployment.

Testing was done by hand as well, with Burp Suite and Postman. Both collections are in `docs/`.

---

## Watching the running system

Preventing an attack and noticing one are different problems. This is the second one.

| Tool | What it answers |
|---|---|
| **Prometheus** | Is something happening more than usual. Counters for requests, failures, sign in failures and model spend |
| **Grafana** | What it looks like over time. A dashboard shipped in the repository, not clicked into a container |
| **Loki** | What exactly happened in one request. Every log line carries a correlation id, so the short message the caller saw can be joined to the full detail the operator needs |
| **Wazuh** | Do these events together mean something |
| **Suricata** | What the traffic looks like on the wire, against 52,132 signatures |
| **ModSecurity** | Refusing obvious attacks at the edge before the application sees them |

### Wazuh

Wazuh is the part that turns log lines into alerts. The application emits a security event whenever
something worth noticing happens, and Wazuh has nine rules written for this system, each carrying
its MITRE ATT&CK technique.

| Rule | Level | Meaning |
|---|---|---|
| 100011 | 3 | one failed sign in, recorded and nothing more |
| 100010 | 10 | eight of them inside two minutes, which is an attack |
| 100020 | 10 | a burst of 404s from one source, which is somebody enumerating |
| 100030 | 10 | authorization denied, possible privilege escalation |
| 100040 | 10 | a session revoked, so a token was probably stolen |
| 100050 | 10 | token verification failed, so a token was tampered with |
| 100060 | 7 | an outbound fetch at an internal address, blocked |
| 100070 | 10 | prompt injection detected |
| 100090 | 7 | an upload refused on its contents |

The pair at the top is the point of the whole thing. One failed sign in is noise, so it is level 3
and stays quiet. Eight in two minutes is a brute force attempt, so it is level 10, and the alert
carries the eight lines that caused it, which means it arrives with its own evidence.

Seven of the nine have fired from real attacks against the running system. The console is at
http://localhost:5601 and needs no login. Open Dashboards, then **Blitzy security events**.

### Generating something to look at

```bash
bash scripts/demo-data.sh quick        # ordinary traffic, so the graphs have a shape
bash scripts/demo-security-events.sh   # one real attack of each kind Wazuh watches for
```

Both make real requests against the running system. Nothing is written into a log by hand.

---

## Checks on every change

Five jobs run on every push and every pull request. Four of them can stop a change.

| Job | Looks for |
|---|---|
| gitleaks | secrets anywhere in the history |
| semgrep | risky patterns in the source |
| osv | known holes in dependencies |
| verify | the project's own suite against throwaway services |
| trivy | holes in the built container image, and produces a parts list |

---

## Layout

```
backend/       the API. Security modules under src/security, policy under src/authz
client/        the shop and the staff area
infra/         nginx, Prometheus, Grafana, Loki, Promtail, Suricata, Wazuh, Postgres setup
scripts/       up.sh to start everything, plus the two demo data scripts
docs/          the demo script, the address list, the Burp and Postman guides
.github/       the pipeline
```

---

## Notes

The AI features need an OpenAI account with credit. Without it the assistant answers that it is
unavailable, and the guards that refuse a bad question still work, because they run before the
model is called.

The eSewa integration runs against the sandbox. The key in `.env.example` is eSewa's own public
test key.

Secrets are never written to a file in this repository. `.env` is ignored, and so are the request
files that `scripts/burp-requests.sh` generates, because they carry a live session cookie.
