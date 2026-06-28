
import "./env";
import "dotenv/config";
import request from "supertest";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import { createApp } from "../app";
import { redisReady, closeRateLimiter } from "../security/rate-limit";
import { closePool } from "../db/client";
import { encrypt } from "../security/crypto";

const PG = () => new Client({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55433),
  user: "migrator", password: process.env.PGPW_MIG, database: "ecommerce",
});

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const ALICE_EMAIL = `alice+${Date.now()}@lab.test`;
const BOB_EMAIL = `bob+${Date.now()}@lab.test`;
const PW = "correct horse battery staple 9Q!";
const ORIGIN = "http://localhost:5173";

async function flushLabRedis() {
  const { Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  await r.flushdb().catch(() => {});
  await r.quit().catch(() => {});
}

async function main() {
  await redisReady;
  await flushLabRedis();
  const app = createApp();
  const db = PG(); await db.connect();

  await db.query(`TRUNCATE coupon_redemptions, coupons, order_status_history, order_items, orders,
    cart_items, carts, addresses, reviews, payments, product_images, products, categories,
    audit_log, idempotency_keys, sessions, accounts, verifications, users RESTART IDENTITY CASCADE`);

  const signup = async (email: string) =>
    request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN)
      .send({ email, password: PW, name: email.split("@")[0] });
  const su1 = await signup(ALICE_EMAIL);
  const su2 = await signup(BOB_EMAIL);
  ok(su1.status === 200, `sign-up via HTTP works (${su1.status})`);
  ok(su2.status === 200, "second user created");

  await db.query(`UPDATE users SET email_verified = true`);
  const aliceId = (await db.query(`SELECT id FROM users WHERE email=$1`, [ALICE_EMAIL])).rows[0].id;
  const bobId = (await db.query(`SELECT id FROM users WHERE email=$1`, [BOB_EMAIL])).rows[0].id;
  await db.query(`UPDATE users SET role='ADMIN' WHERE id=$1`, [bobId]);

  const signin = async (email: string) => {
    const r = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN)
      .send({ email, password: PW });
    return { status: r.status, cookies: (r.headers["set-cookie"] ?? []) as unknown as string[] };
  };
  const alice = await signin(ALICE_EMAIL);
  const bob = await signin(BOB_EMAIL);
  ok(alice.status === 200 && alice.cookies.length > 0, "sign-in returns a session cookie");
  const aliceCookie = alice.cookies.map(c => c.split(";")[0]).join("; ");
  const bobCookie = bob.cookies.map(c => c.split(";")[0]).join("; ");

  const h = await request(app).get("/health");
  ok(h.status === 200, "health endpoint up");
  ok(!h.headers["x-powered-by"], "X-Powered-By removed (§7.13)");
  ok(/frame-ancestors 'none'/.test(h.headers["content-security-policy"] ?? ""), "CSP frame-ancestors 'none'");
  ok(/object-src 'none'/.test(h.headers["content-security-policy"] ?? ""), "CSP object-src 'none'");
  ok(/base-uri 'none'/.test(h.headers["content-security-policy"] ?? ""), "CSP base-uri 'none'");
  ok(/nonce-/.test(h.headers["content-security-policy"] ?? ""), "CSP carries a per-request nonce");
  ok(h.headers["x-frame-options"] === "DENY", "X-Frame-Options: DENY");
  ok(h.headers["x-content-type-options"] === "nosniff", "nosniff");
  ok(!("x-xss-protection" in h.headers) || h.headers["x-xss-protection"] === "0",
     `X-XSS-Protection not enabled (got "${h.headers["x-xss-protection"] ?? "absent"}")`);
  const h2 = await request(app).get("/health");
  const n1 = /nonce-([^']+)/.exec(h.headers["content-security-policy"] ?? "")?.[1];
  const n2 = /nonce-([^']+)/.exec(h2.headers["content-security-policy"] ?? "")?.[1];
  ok(!!n1 && !!n2 && n1 !== n2, "CSP nonce differs per request (not a fixed value)");

  const corsOk = await request(app).get("/api/products").set("Origin", ORIGIN);
  ok(corsOk.headers["access-control-allow-origin"] === ORIGIN, "allowed origin echoed");
  ok(corsOk.headers["vary"]?.includes("Origin"), "Vary: Origin set (cache poisoning guard)");
  const corsEvil = await request(app).get("/api/products").set("Origin", "https://evil.com");
  ok(!corsEvil.headers["access-control-allow-origin"], "disallowed origin gets NO ACAO header");
  ok(corsEvil.status === 200, "…and is not 403 (no allowlist-membership oracle)");

  const trace = await request(app).trace("/api/products");
  ok(trace.status === 405, `TRACE rejected (${trace.status})`);
  const smuggle = await request(app).post("/api/orders/checkout")
    .set("Origin", ORIGIN).set("Transfer-Encoding", "chunked").set("Content-Length", "10").send({});
  ok(smuggle.status === 400, `CL+TE ambiguous framing rejected (${smuggle.status})`);
  const wrongMethod = await request(app).delete("/api/products").set("Origin", ORIGIN).set("Cookie", aliceCookie);
  ok([403, 404, 405].includes(wrongMethod.status),
     `unexpected verb refused before reaching a handler (${wrongMethod.status})`);

  const noOrigin = await request(app).post("/api/orders/checkout").set("Cookie", aliceCookie).send({});
  ok(noOrigin.status === 403, `state change with MISSING Origin rejected (${noOrigin.status})`);
  const crossSite = await request(app).post("/api/orders/checkout")
    .set("Cookie", aliceCookie).set("Origin", "https://evil.com").send({});
  ok(crossSite.status === 403, `cross-site Origin rejected (${crossSite.status})`);
  const secFetch = await request(app).post("/api/orders/checkout")
    .set("Cookie", aliceCookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "cross-site").send({});
  ok(secFetch.status === 403, `Sec-Fetch-Site: cross-site rejected (${secFetch.status})`);

  const sameSiteAllowed = await request(app).post("/api/orders/checkout")
    .set("Cookie", aliceCookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-site").send({});
  ok(sameSiteAllowed.status !== 403,
    `Sec-Fetch-Site: same-site reaches the origin check (${sameSiteAllowed.status})`);
  const sameSiteBadOrigin = await request(app).post("/api/orders/checkout")
    .set("Cookie", aliceCookie).set("Origin", "https://evil.com")
    .set("Sec-Fetch-Site", "same-site").send({});
  ok(sameSiteBadOrigin.status === 403,
    `Sec-Fetch-Site: same-site with a disallowed Origin still rejected (${sameSiteBadOrigin.status})`);

  const noCsrfToken = await request(app).post("/api/orders/checkout")
    .set("Cookie", aliceCookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin").send({});
  ok(noCsrfToken.status === 403, `missing CSRF token rejected, not skipped (${noCsrfToken.status})`);

  const anon = await request(app).get("/api/orders");
  ok(anon.status === 401, `unauthenticated => 401 (${anon.status})`);
  const anonMe = await request(app).get("/api/me");
  ok(anonMe.status === 401, "unauthenticated /api/me => 401");

  const aliceAdmin = await request(app).get("/api/admin/orders").set("Cookie", aliceCookie);
  ok(aliceAdmin.status === 404, `non-admin on admin route => 404, not 403 (${aliceAdmin.status})`);
  const bobAdmin = await request(app).get("/api/admin/orders").set("Cookie", bobCookie);
  ok(bobAdmin.status === 200, `admin reaches admin route (${bobAdmin.status})`);
  const overrideAttempt = await request(app).get("/api/orders")
    .set("Cookie", aliceCookie).set("X-Original-URL", "/api/admin/orders").set("X-Rewrite-URL", "/api/admin/orders");
  ok(overrideAttempt.status === 200, "X-Original-URL/X-Rewrite-URL do not reroute (still own orders)");
  ok(!JSON.stringify(overrideAttempt.body).includes("admin"), "override headers gained no admin data");

  const csrfRes = await request(app).get("/api/csrf-token").set("Cookie", aliceCookie);
  const csrfToken = csrfRes.body.csrfToken as string;
  const csrfCookie = ((csrfRes.headers["set-cookie"] ?? []) as unknown as string[])
    .map(c => c.split(";")[0]).join("; ");
  const authed = `${aliceCookie}; ${csrfCookie}`;
  ok(typeof csrfToken === "string" && csrfToken.length > 10, "CSRF token issued on a safe method");

  const roleEscalation = await request(app).patch("/api/me")
    .set("Cookie", authed).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", csrfToken).send({ name: "Alice", role: "ADMIN" });
  ok(roleEscalation.status === 400, `PATCH /me {"role":"ADMIN"} => 400 (${roleEscalation.status})`);
  const roleAfter = (await db.query(`SELECT role FROM users WHERE id=$1`, [aliceId])).rows[0].role;
  ok(roleAfter === "USER", "role unchanged in the database");

  const legitPatch = await request(app).patch("/api/me")
    .set("Cookie", authed).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", csrfToken).send({ name: "Alice Updated" });
  ok(legitPatch.status === 200, `legitimate PATCH succeeds with a valid token (${legitPatch.status})`);

  const catId = uuidv7(), prodId = uuidv7(), addrId = uuidv7();
  await db.query(`INSERT INTO categories (id,name,slug) VALUES ($1,'C','c')`, [catId]);
  await db.query(`INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock)
                  VALUES ($1,$2,$3,'Widget','widget',10000,10000,50)`, [prodId, bobId, catId]);
  await db.query(`INSERT INTO addresses (id,user_id,recipient_name_encrypted,phone_encrypted,
    street_encrypted,city,state,postal_code_encrypted,country) VALUES ($1,$2,$3,$4,$5,'K','B',$6,'NP')`,
    [addrId, aliceId, encrypt("R","pii:address"), encrypt("9","pii:phone"), encrypt("S","pii:address"), encrypt("4","pii:address")]);
  const cartId = uuidv7();
  await db.query(`INSERT INTO carts (id,user_id) VALUES ($1,$2)`, [cartId, aliceId]);
  await db.query(`INSERT INTO cart_items (id,cart_id,product_id,quantity) VALUES ($1,$2,$3,2)`, [uuidv7(), cartId, prodId]);

  const post = (body: unknown) => request(app).post("/api/orders/checkout")
    .set("Cookie", authed).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", csrfToken).send(body as object);

  const tamper = await post({ addressId: addrId, paymentMethod: "CARD", totalPaisa: 1 });
  ok(tamper.status === 400, `checkout with totalPaisa in body => 400 (${tamper.status})`);
  const tamper2 = await post({ addressId: addrId, paymentMethod: "CARD", subtotalPaisa: 0, discountPaisa: 999999 });
  ok(tamper2.status === 400, "checkout with discountPaisa/subtotalPaisa => 400");

  const good = await post({ addressId: addrId, paymentMethod: "CARD" });
  ok(good.status === 201, `legitimate checkout succeeds (${good.status})`);
  const expectedTotal = String(20000n + 5000n + (20000n * 1300n) / 10000n);
  ok(good.body.totalPaisa === expectedTotal,
     `total server-computed = ${expectedTotal} paisa (got ${good.body.totalPaisa})`);
  ok(good.body.subtotalPaisa === "20000", "subtotal is 2 x 10000 from the DB, not the client");
  const aliceOrderId = good.body.orderId as string;

  const bobReadsAlice = await request(app).get(`/api/orders/${aliceOrderId}`).set("Cookie", bobCookie);
  ok(bobReadsAlice.status === 404, `another user's order => 404, never 403 (${bobReadsAlice.status})`);
  const aliceReadsOwn = await request(app).get(`/api/orders/${aliceOrderId}`).set("Cookie", aliceCookie);
  ok(aliceReadsOwn.status === 200, "owner can read their own order");
  ok(!("userId" in (aliceReadsOwn.body ?? {})), "response omits userId (explicit column selection)");

  const sqli = await request(app).get("/api/products?sort=" + encodeURIComponent("name;DROP TABLE products--"));
  ok(sqli.status === 400, `ORDER BY injection rejected by the enum (${sqli.status})`);
  const stillThere = await db.query(`SELECT count(*)::int n FROM products`);
  ok(stillThere.rows[0].n > 0, "products table intact");
  const unknownKey = await request(app).get("/api/products?evil=1");
  ok(unknownKey.status === 400, "unknown query key rejected by .strict()");

  const notFound = await request(app).get("/api/does-not-exist");
  ok(notFound.status === 404, "unknown route => 404");
  ok(typeof notFound.body.correlationId === "string", "404 carries a correlationId");
  ok(!JSON.stringify(notFound.body).toLowerCase().includes("stack"), "no stack trace in body");

  await db.end();
  await closeRateLimiter();
  await closePool();
  console.log(`\nHTTP end-to-end: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
