# Every screen, with the exact address

Open these in this order while recording. Each row gives the address to type, what to click once
you are there, and what should be on screen. Every address below was checked and answers 200.

Start everything and confirm it answers:

```bash
bash scripts/up.sh
```

Then fill the dashboards, or half of these screens are empty:

```bash
bash scripts/demo-data.sh quick
bash scripts/demo-security-events.sh
```

---

## The short list, if you only want addresses

```
http://localhost:5173                          the shop
http://localhost:5173/admin                    the admin panel
http://localhost:8080/api/products             the API through nginx and ModSecurity
http://localhost:9090/targets                  Prometheus, scrape health
http://localhost:9090/query                    Prometheus, ad-hoc queries
http://localhost:3000/d/blitzy-security        Grafana, the Blitzy dashboard
http://localhost:3000/explore                  Grafana, Loki log search
http://localhost:5601/app/dashboards           Wazuh, the dashboard list
http://localhost:5601/app/discover             Wazuh, raw alerts
http://localhost:5601/app/wz-home              Wazuh, the product's own console
```

Grafana asks for `admin` and the password in `GRAFANA_PW` in `.env`. Nothing else asks for a
login.

---

## Ports, all of them

| Port | Bound to | What | Must be free before you start |
|---|---|---|---|
| **5173** | your machine | the shop and admin panel, Vite | **yes.** Only this origin is allowed by CORS |
| **8080** | `0.0.0.0` | nginx, ModSecurity, then the API. Attack this one | **yes.** Burp's default proxy listener also wants 8080, so move Burp's to 8081 |
| **8000** | your machine | the API development server, for the flag-off half of a pair | only if you run it |
| **3000** | `127.0.0.1` | Grafana | yes |
| **9090** | `127.0.0.1` | Prometheus | yes |
| **5601** | `127.0.0.1` | the Wazuh dashboard | yes |
| 55433 | `127.0.0.1` | PostgreSQL | yes |
| 56379 | `127.0.0.1` | Redis | yes |
| 57017 | `127.0.0.1` | MongoDB | yes |

Everything except 5173 and 8080 is bound to loopback, so nothing on your network can reach it.

Reachable only from inside the Docker network, published to nothing:

| Address | What |
|---|---|
| `api:8000` | the containerised API. The only way in is through nginx on 8080 |
| `wazuh-indexer:9200` | where the alerts are stored |
| `wazuh:55000` | the Wazuh manager API, plus 1514-1516 and 514/udp for agents |
| `loki:3100` | the log store. Reached through Grafana, never directly |
| `postgres:5432`, `redis:6379`, `mongo:27017` | the data stores as the API sees them |

That last row is why the outbound guard matters. An unguarded fetch inside the API reaches all
three by name, which is exactly what `http://redis:6379/x.png` demonstrates.

### If a port is already taken

```bash
netstat -ano | findstr :5173
```

Take the PID from the last column and end it in Task Manager, or `taskkill /PID <pid> /F`.

---

## 1. The application

### http://localhost:5173

Browse, open a product, sign in as `sunita@shop.test` with `Nepal@Shop2026!`, add to cart, check
out with cash on delivery.

**It must be 5173.** Only that origin is allowed by CORS. If Vite says 5174 because 5173 was
taken, stop it, free 5173 and start again, or every call in the recording fails.

### http://localhost:5173/admin

Sign in as `admin@shop.test` in a second browser profile. Products, orders, users.

---

## 2. The API, through the edge

### http://localhost:8080/api/products

Proves the containerised path is alive. This is the port every attack should target, because it
is the only one nginx and ModSecurity sit in front of, the only one Suricata sees, and the only
one whose log reaches Wazuh.

Worth showing beside it, in a terminal:

```bash
curl -i http://localhost:8080/api/products | head -20
```

The security headers are in that output: content security policy, strict transport security,
no-sniff, referrer policy, and no `Server` version.

### The one that proves the edge is doing something

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: evil.test" http://localhost:8080/api/products
```

Empty reply or `000`. An unrecognised `Host` is dropped without an answer.

---

## 3. Prometheus

### http://localhost:9090/targets

Three targets, all **UP**. Screenshot the whole table.

### http://localhost:9090/query

`/graph` redirects here in Prometheus 3. Paste each query into the box and press Execute.

| Paste this | Tab | Should show |
|---|---|---|
| `up` | Table | three rows, all value 1 |
| `auth_login_failure_total` | Graph | a rising line. **Pick the `api:8000` series** |
| `sum by (status) (http_requests_total)` | Table | 200 beside 400, 401, 404, 429 |
| `sum(rate(http_requests_total[1m]))` | Graph | the shape of the demo traffic |
| `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))` | Graph | latency, 95th percentile |

> Two instances are scraped. `host.docker.internal:8000` is the development server on your
> machine and reads zero unless you restarted it recently. `api:8000` is the container, and it is
> the one with data. In the legend, click the `api:8000` series to isolate it.

Do not screenshot `rate_limit_tripped_total`. It is declared but has no samples, because the 429s
come from the authentication library's limiter rather than the application counter.

---

## 4. Grafana

Login: `admin`, password from `GRAFANA_PW` in `.env`. Not `admin`/`admin`.

### http://localhost:3000/d/blitzy-security

The **Blitzy security** dashboard, six panels:

| Panel | Reads |
|---|---|
| Request rate | requests per second |
| Requests by status | the same split by response code |
| Failed sign-in attempts | the counter the spraying run moved |
| Total requests served | one number |
| Error responses, 4xx and 5xx | the refusals |
| Request latency, 95th percentile | how long the refusals take |

Set the time picker to **Last 1 hour** and the refresh to **10s** so the panels move on camera.

The dashboard and both datasources are provisioned from
[infra/detection/grafana/](../infra/detection/grafana/), so this address survives a rebuild.

### http://localhost:3000/explore

Pick **Loki** in the datasource dropdown at the top left, then paste into the query box and press
Shift+Enter:

```
{container="/blitzy-api-1"}
```

The label is `container`, not `job`. Then the shot that is worth the most:

1. In Postman or Burp, send a request that fails and copy the `correlationId` out of the body
2. Back in Explore, run
   ```
   {container="/blitzy-api-1"} |= "PASTE-THE-CORRELATION-ID"
   ```

The client got four words and an id. The log has the method, the path, the actor, the full error
and the stack. Same request, two audiences, joined by that id.

---

## 5. Wazuh

No login. If a login page appears, the container did not pick up its config, so
`docker compose --profile app --profile detection up -d --force-recreate wazuh-dashboard`.

### http://localhost:5601/app/dashboards

Click **Blitzy security events**.

Direct link, if you would rather not click:

```
http://localhost:5601/app/dashboards#/view/blitzy-security-dashboard
```

Set the time picker to **Last 24 hours**.

| Panel | Shows |
|---|---|
| Blitzy - custom rule alerts | the total |
| Blitzy - severity mix | levels 3, 7, 10 as a donut |
| Blitzy - alerts over time | bars split by rule |
| Blitzy - which rules fired | rule id, description and level, sorted by count |
| Blitzy - sources of failed sign-ins | address beside the answer given |
| Blitzy - security events | the raw alerts underneath |

**The shot that lands:** in the bottom table, expand one row of rule **100010** and scroll to
`previous_output`. It holds the eight log lines that triggered it. The alert carries its own
evidence, which is the whole argument for correlation over alerting on single events.

### http://localhost:5601/app/discover

For the raw view. Index pattern **`wazuh-alerts-*`** is already selected. Type into the search
bar:

| Query | Shows |
|---|---|
| `rule.groups:ecommerce` | everything the custom rules raised |
| `rule.id:100010 or rule.id:100011` | one failed sign-in beside the conclusion drawn from many |
| `rule.level:>=10` | only what would page someone |
| `data.sec_event:SSRF_BLOCKED` | the outbound guard refusing internal hosts |

Add columns from the left panel: `rule.id`, `rule.level`, `rule.description`, `data.sec_event`,
`data.ip`. Time picker on **Last 24 hours**.

### http://localhost:5601/app/wz-home

Wazuh's own console, if you want to show the product rather than the data. Modules, the rule set,
the manager status. The manager is enrolled as agent `000`, which is itself.

### The rules those alerts came from

Open [infra/detection/wazuh/local_rules.xml](../infra/detection/wazuh/local_rules.xml) in the
editor beside the dashboard. Rules **100011** and **100010** are the pair to point at: one failed
sign-in is level 3 and does not alert, eight inside two minutes is level 10 and does.

Currently firing, all from real requests:

| Rule | Level | Meaning |
|---|---|---|
| 100011 | 3 | one failed sign-in |
| 100010 | 10 | brute force, T1110 |
| 100030 | 10 | authorization denied, T1068 |
| 100050 | 10 | JWT verification failure, T1550 |
| 100060 | 7 | SSRF blocked by the app guard, T1190 |
| 100070 | 10 | prompt injection detected |
| 100090 | 7 | upload rejected on magic bytes, T1105 |

---

## Showing the nginx edge

There is no web interface for nginx, so it is shown by what it refuses. Every result below was
measured against the running stack.

### The one-screen comparison

Run these side by side. Same payload, two ports, two different layers answering.

```bash
Q='sort=(SELECT%20CASE%20WHEN%20(1=1)%20THEN%20name%20END)'
curl -s -o /dev/null -w "edge  8080 -> %{http_code}
" "http://localhost:8080/api/products?$Q"
curl -s -o /dev/null -w "app   8000 -> %{http_code}
" "http://localhost:8000/api/products?$Q"
```

```
edge  8080 -> 403      ModSecurity, before the application sees it
app   8000 -> 400      the application's own allowlist
```

### What the edge refuses on its own

| Send this | Answer | What it proves |
|---|---|---|
| `curl -s -o /dev/null -w "%{http_code}
" http://localhost:8080/api/products` | **200** | normal traffic passes |
| `...?sort=(SELECT%20CASE%20WHEN%20(1=1)%20THEN%20name%20END)` | **403** | SQL payload scored above threshold |
| `...?q=%3Cscript%3Ealert(1)%3C/script%3E` | **403** | script markup scored above threshold |
| `-H "Host: evil.test"` | **no reply at all** | an unrecognised host is dropped, not answered |
| `-X TRACE http://localhost:8080/` | **405** | TRACE is refused |
| `http://localhost:8080/metrics` | **404** | metrics are not reachable through the edge |
| `http://localhost:8000/metrics` | **200** | but they exist, so the 404 is a decision |

That last pair is the one worth narrating. The endpoint is real and it is deliberately not
published, rather than simply absent.

### The log line that proves it was ModSecurity

```bash
docker compose logs nginx --since 2m | grep ModSecurity | tail -1
```

```
ModSecurity: Access denied with code 403 (phase 2). Matched "Operator `Ge' with parameter `5'
against variable `TX:BLOCKING_INBOUND_ANOMALY_SCORE' (Value: `20')
[file ".../REQUEST-949-BLOCKING-EVALUATION.conf"] [id "949110"]
[msg "Inbound Anomaly Score Exceeded (Total Score: 20)"] [ver "OWASP_CRS/4.28.0"]
```

Point at three things: **phase 2**, so the request body had been parsed and the decision was made
before proxying; the **anomaly score**, because CRS scores rather than matching one rule; and
**OWASP_CRS/4.28.0**, the version, printed by the product itself rather than claimed.

### The versions, read from the container

```bash
docker compose exec nginx nginx -v
docker compose exec nginx grep -E "^SecRuleEngine" /etc/modsecurity.d/modsecurity.conf
```

```
nginx version: nginx/1.30.4
SecRuleEngine On
```

`SecRuleEngine On` is worth saying out loud: it is blocking, not `DetectionOnly`.

### The configuration, in the repository

Open [docker-compose.yml](../docker-compose.yml) at the `nginx` service. Two things to point at:

- the image is pinned **by digest**, not by a floating tag, so the edge cannot change under you
- `BLOCKING_PARANOIA: "1"`, set deliberately low, because the application is what is under test.
  A determined encoding is meant to slip past the edge and still be refused by the application

### Known gap, worth saying rather than hiding

`MODSEC_AUDIT_LOG` is configured but the file is never written, so the per-rule detail
(which CRS rule scored what) is not available. The nginx error log carries the decision, the
score, the rule id and the CRS version, which is enough to evidence the block. If a reviewer asks
which individual rules contributed, the honest answer is that the audit log is not being produced.

---

## 6. Suricata

No web interface. Terminal only.

```bash
docker compose exec suricata sh -c 'grep "rules successfully loaded" /var/log/suricata/suricata.log | tail -1'
docker compose exec suricata sh -c 'grep \"event_type\":\"alert\" /var/log/suricata/eve.json | tail -1'
docker compose exec suricata sh -c 'grep -c \"event_type\":\"alert\" /var/log/suricata/eve.json'
```

Fifty two thousand signatures, and a real alert. Say why it works: the sensor shares the API
container's network namespace, so it sees application traffic rather than an empty bridge.

---

## 7. The two-layer moment

Thirty seconds, and it is the clearest picture of defence in depth in the system. Run both, then
show the nginx log.

```bash
# looks like an attack, refused at the edge, the application never sees it
curl -s -o /dev/null -w "metadata address -> %{http_code}\n" \
  -X POST http://localhost:8080/api/uploads/products/image-from-url \
  -H 'content-type: application/json' \
  -d '{"url":"http://169.254.169.254/latest/meta-data/","productId":"x"}'

# looks ordinary, passes the rule set, refused by the application
docker compose logs nginx --since 2m | grep ModSecurity | tail -1
```

403 from ModSecurity on the first. An internal hostname such as `http://redis:6379/x.png` gets
past the rule set and is refused by the application guard with 400, and that one produces the
Wazuh alert.

---

## 8. The pipeline

GitHub, **Actions**, open the most recent run of `ci`. Five jobs: `gitleaks`, `semgrep`, `osv`,
`verify`, `trivy`.

Locally:

```bash
cd backend && npm run verify        # the offline suite
cd backend && npm run demo:pairs    # every control, held and broken
cd backend && npm run demo:list     # all 23 flags, all off
```

`demo:pairs` is the one to film. It asserts each control holds when it is on **and** that the
attack succeeds when the flag turns it off. A control that cannot be shown to break has not been
shown to work.

---

## If a screen is empty

| Screen | Why | Fix |
|---|---|---|
| Prometheus graph flat | you are on `host.docker.internal:8000` | click `api:8000` in the legend |
| Grafana panels say No data | time picker too narrow, or nothing ran recently | Last 1 hour, then `bash scripts/demo-data.sh quick` |
| Loki returns nothing | the label is `container`, not `job` | `{container="/blitzy-api-1"}` |
| Wazuh dashboard empty | time picker, or events never fed | Last 24 hours, then `bash scripts/demo-security-events.sh` |
| Wazuh shows 100011 but no 100010 | the log went in as one batch | the script drips it. Do not paste the block by hand |
| Wazuh asks for a login | the container missed its config | `docker compose --profile app --profile detection up -d --force-recreate wazuh-dashboard` |
| Wazuh modules say the API is unreachable | the manager volume was recreated | the one-command fix is in [STACK-GUIDE.md](STACK-GUIDE.md) |
| The shop errors on every call | the client is on 5174 | free 5173 and restart it |
