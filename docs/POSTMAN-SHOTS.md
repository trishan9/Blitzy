# Filling the Test Results Section

The report has one subsection, **Section 5, Test results**, holding three grids of labelled slots.
This guide fills them in slot order, top to bottom. Work down the tables and you are done.

Each row gives the exact request, which pane to screenshot, and what the response should say.
**The green ticks under Test Results in Postman tell you the shot is valid.** A red test means the
screenshot proves nothing.

---

## Setup, once

Import both files, then pick **blitzy local** in the environment dropdown:

```
docs/postman/blitzy.postman_collection.json
docs/postman/blitzy-local.postman_environment.json
```

Settings → General → **Automatically follow redirects: off**.

The environment carries two base URLs. `base` is `http://localhost:8000/api`, the development
server, which is right for the evidence slots because they are claims about the application's own
controls. `edge` is `http://localhost:8080/api`, through nginx and ModSecurity. **If you want a
Postman run to also show up in Wazuh, Suricata and Prometheus, set** `base` **to the** `edge` **value**,
because only the containerised path is watched. Set it back afterwards, or ModSecurity will start
answering requests the application was supposed to answer.

Generate the Burp requests, which arrive with live cookies and ids already filled in:

```bash
bash scripts/burp-requests.sh
```

**Run Postman folder** `1 Setup` **first.** It signs in and captures the order id the cross-customer
test needs.

---



## Grid 1, Driven from Postman

Eleven slots, in this order.


| Slot               | Request                                                     | Screenshot      | Should say                                                    |
| ------------------ | ----------------------------------------------------------- | --------------- | ------------------------------------------------------------- |
| 1 · Evidence 5.1   | `3 Attacks → SQL injection in the sort parameter`           | Body + status   | **400**, `{"message":"Invalid query"}`                        |
| 2 · Evidence 5.1   | `3 Attacks → The valid sort, for contrast`                  | Body + status   | **200**, products cheapest first                              |
| 3 · Evidence 5.4   | `2 Evidence → A write with no CSRF token is refused`        | Body + status   | **403**, body is an error plus `correlationId` only           |
| 4 · Evidence 5.4   | `2 Evidence → The same write with a token succeeds`         | Status          | **200**                                                       |
| 5 · Evidence 5.6   | `3 Attacks → Server-side request forgery to cloud metadata` | Status          | **404**                                                       |
| 6 · Evidence 5.7   | `3 Attacks → One customer reading another customer's order` | Status          | **404**, not 403                                              |
| 7 · Evidence 5.7   | `3 Attacks → An admin route as a normal customer`           | Status          | **404**                                                       |
| 8 · Evidence 5.13  | `3 Attacks → A malformed body, for the error handler`       | Body            | **400**, no stack trace, no table name                        |
| 9 · Evidence 5.16  | `1 Setup → Sign in as sunita, the victim`                   | **Headers** tab | `Set-Cookie` with `HttpOnly`, `Secure`, `SameSite`, `__Host-` |
| 10 · Evidence 5.18 | `2 Evidence → Security headers on every response`           | **Headers** tab | policy, transport security, no-sniff, referrer                |
| 11 · Evidence 5.18 | Runner → folder `4 Rate limiting`, **11 iterations**        | Run summary     | three **401**, then **429** for the rest                      |


Three of these are worth a second of care:

**Slot 9** is the **Headers** tab, not the body. Expand `Set-Cookie` so all four words are legible.
Those four words are the entire evidence.

**Slot 11** needs the Runner, not Send. Tick only the folder `4 Rate limiting`, iterations 11,
delay 0. Sign-in allows three attempts every ten seconds, so with no delay you get three 401 then
429 for the rest. This run also feeds the Wazuh alert and the Prometheus counter, so do it before
the monitoring shots.

Burp Intruder makes a stronger image for this slot than the Postman Runner, because twenty five
paced guesses show the limit opening and closing rather than tripping once. Either is valid.
The full walkthrough is in [BURP-INTRUDER-BRUTEFORCE.md](BURP-INTRUDER-BRUTEFORCE.md).

**Slot 5** returns 404 rather than 400, and that is correct. The route is admin only, so
authorization refuses it before the SSRF guard is reached. Sign in as `admin@shop.test` first if
you would rather show the guard itself returning 400.

---



## Grid 2, Driven from Burp Suite

Eight slots. Paste each file into a Repeater tab: new tab, click the request pane, `Ctrl+V`.


| Slot              | Paste this file                                                                                        | Screenshot             | Should say                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------------------------- |
| 1 · Evidence 5.3  | `05-stored-xss-review-needs-a-purchase.txt` then `06-read-back-the-review.txt`                         | the read-back response | the comment stored as plain text, script tag gone                    |
| 2 · Evidence 5.5  | `09-cors-evil-origin.txt`                                                                              | response **headers**   | **no** `access-control-allow-origin` header. The absence is the shot |
| 3 · Evidence 5.9  | build in JWT Editor, see below                                                                         | status                 | **401**                                                              |
| 4 · Evidence 5.10 | upload a text file renamed `.png`                                                                      | status                 | **400**                                                              |
| 5 · Evidence 5.15 | `11-path-traversal-404.txt`                                                                            | status                 | **404**                                                              |
| 6 · Evidence 5.11 | `14-price-tampering-400.txt`                                                                           | status                 | **400**                                                              |
| 7 · Evidence 5.11 | the same request, backend restarted with the flag                                                      | status                 | **201**, an order for one paisa                                      |
| 8 · Evidence 5.12 | a checkout request in **Turbo Intruder**, 20 concurrent, one unit of stock. See BURP-GUIDE section 4.3 | results table          | one **201**, the rest **409**                                        |


**Slot 7 is the most valuable single image in the report.** Restart the backend with one control
removed and resend the identical request:

```bash
cd backend
DEMO_MODE=true TRUST_CLIENT_TOTAL=true npm run dev
```

Restart normally afterwards and confirm the boot banner shows zero active flags.

**Slot 1** needs sunita to have actually bought that product, because only a verified purchaser may
review. Buy it in the app first, or do this one through the interface.

**Slot 3** is built by hand: take any request with an `Authorization: Bearer` header, open JWT
Editor, change the header to `"alg":"none"`, strip the signature, send.

---



## Grid 3, Read directly

Four slots. These cannot be shown over HTTP, so screenshot the terminal or the editor.


| Slot              | Command or file                                                                                           | Should say                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 · Evidence 5.16 | `docker compose exec -T postgres psql -U postgres -d ecommerce -c "SELECT phone FROM addresses LIMIT 3;"` | ciphertext where phone numbers should be                           |
| 2 · Evidence 5.2  | an operator object in the activity filter, sent as admin                                                  | refused by the typed schema                                        |
| 3 · Evidence 5.14 | `backend/src/invoices/invoice-pdf.ts` lines 1 to 25 and 57 to 70                                          | the comment naming the pattern avoided, and the in-process builder |
| 4 · Evidence 5.17 | an instruction-override question to `/api/ai/assistant`                                                   | no system prompt and no links in the reply                         |


---



## The monitoring slots

Eight more slots sit further up the same section, beside the detection table. Generate the data
first or the graphs are flat:

```bash
bash scripts/demo-data.sh
docker compose logs api --no-log-prefix --since 6m | grep '^{' | grep sec_event >> logs/api.log
```

Wait a minute for Wazuh to analyse, then:


| Slot               | Where                                                                                                                                              | Should say                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Prometheus targets | [http://localhost:9090/targets](http://localhost:9090/targets)                                                                                     | three targets, all **UP**                           |
| Failed sign-ins    | `/graph` → `auth_login_failure_total`                                                                                                              | a rising line                                       |
| Traffic by outcome | `/graph` → `sum by (status) (http_requests_total)`                                                                                                 | 200 beside 400, 401, 404, 429                       |
| Grafana            | [http://localhost:3000](http://localhost:3000), user `admin`, password from `GRAFANA_PW` in `.env`                                                 | request rate and error rate                         |
| Loki               | Grafana → Explore → Loki → `{container="/blitzy-api-1"}`                                                                                           | the log stream                                      |
| One request traced | filter that view to a single `correlationId`                                                                                                       | the generic error and the full detail, joined       |
| Wazuh terminal     | `docker compose exec wazuh bash -c 'grep 100010 /var/ossec/logs/alerts/alerts.json                                                                 | tail -1'`                                           |
| Wazuh dashboard    | [http://localhost:5601](http://localhost:5601), no login, **Explore → Discover**, index `wazuh-alerts-`*, query `rule.id:100010 or rule.id:100011` | the histogram and the hit table, both rules present |
| Suricata           | `docker compose exec suricata sh -c 'grep event_type:alert /var/log/suricata/eve.json                                                              | tail -1'`                                           |


> **Pick the** `api:8000` **series in Prometheus.** Two instances are scraped.
> `host.docker.internal:8000` is the development server on your machine and reads zero unless you
> have restarted it recently. The containerised `api:8000` is the one with data.
>
> Do not screenshot `rate_limit_tripped_total`. It is declared but has no samples, because the 429s
> come from the authentication library's own limiter rather than the application counter. Use
> `auth_login_failure_total` for the rate-limiting story.

---



## If something looks wrong


| Symptom                       | Cause                                                                                                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401 where there should not be | the session expired. Re-run Postman folder `1 Setup`, or `bash scripts/burp-requests.sh`                                                                                                                                                 |
| 403 unexpectedly              | the CSRF token went stale. Check the environment dropdown still says **blitzy local**                                                                                                                                                    |
| A flat Prometheus graph       | you are on the `host.docker.internal:8000` series. Switch to `api:8000`                                                                                                                                                                  |
| Wazuh shows no rule 100010    | the log has not been fed in, or it went in as one batch. Wazuh counts toward the eight-in-two-minutes threshold as lines arrive, so paste them in slowly. The drip loop is in [BURP-INTRUDER-BRUTEFORCE.md](BURP-INTRUDER-BRUTEFORCE.md) |
| The browser app misbehaves    | clear site data, and make sure the client is on **5173**, not 5174                                                                                                                                                                       |


