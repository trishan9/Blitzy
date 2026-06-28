
import "./env";
import "dotenv/config";
import request from "supertest";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import sharp from "sharp";
import { createApp } from "../app";
import { redisReady, closeRateLimiter } from "../security/rate-limit";
import { closePool } from "../db/client";
import { sanitiseProse, isSafeUrl } from "../security/sanitise";

const PG = () => new Client({
  host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433),
  user: "migrator", password: process.env.PGPW_MIG, database: "ecommerce",
});

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const EMAIL = `u+${Date.now()}@lab.test`;
const ADMIN_EMAIL = `adm+${Date.now()}@lab.test`;
const PW = "correct horse battery staple 7X!";
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

  const xss = `<img src=x onerror=alert(1)>Great!<script>steal()</script><a href="javascript:alert(1)">c</a>`;
  const clean = sanitiseProse(xss);
  ok(!/onerror/i.test(clean), "DOMPurify strips onerror handler");
  ok(!/<script/i.test(clean), "script tag stripped");
  ok(!/javascript:/i.test(clean), "javascript: URL stripped");
  ok(!/<img/i.test(clean), "img not in the prose allowlist");
  ok(clean.includes("Great!"), "legitimate text preserved");
  ok(!isSafeUrl("javascript:alert(1)"), "javascript: URL rejected by scheme allowlist");
  ok(!isSafeUrl("data:text/html;base64,PHNjcmlwdD4="), "data: URL rejected");
  ok(isSafeUrl("https://example.com/x.png"), "https URL allowed");

  for (const e of [EMAIL, ADMIN_EMAIL]) {
    await request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN)
      .send({ email: e, password: PW, name: e.split("@")[0] });
  }
  await db.query(`UPDATE users SET email_verified = true`);
  const uid = (await db.query(`SELECT id FROM users WHERE email=$1`, [EMAIL])).rows[0].id;
  const aid = (await db.query(`SELECT id FROM users WHERE email=$1`, [ADMIN_EMAIL])).rows[0].id;
  await db.query(`UPDATE users SET role='ADMIN' WHERE id=$1`, [aid]);

  const signin = async (email: string) => {
    const r = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password: PW });
    return ((r.headers["set-cookie"] ?? []) as unknown as string[]).map(c => c.split(";")[0]).join("; ");
  };
  const userCookie = await signin(EMAIL);
  const adminCookie = await signin(ADMIN_EMAIL);

  const csrfFor = async (cookie: string) => {
    const r = await request(app).get("/api/csrf-token").set("Cookie", cookie);
    const cc = ((r.headers["set-cookie"] ?? []) as unknown as string[]).map(c => c.split(";")[0]).join("; ");
    return { token: r.body.csrfToken as string, cookie: `${cookie}; ${cc}` };
  };
  const u = await csrfFor(userCookie);
  const a = await csrfFor(adminCookie);
  const post = (path: string, ctx: { token: string; cookie: string }) =>
    request(app).post(path).set("Cookie", ctx.cookie).set("Origin", ORIGIN)
      .set("Sec-Fetch-Site", "same-origin").set("x-csrf-token", ctx.token);

  const catId = uuidv7(), prodId = uuidv7();
  await db.query(`INSERT INTO categories (id,name,slug) VALUES ($1,'Cat','cat')`, [catId]);
  await db.query(`INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock,per_order_limit)
                  VALUES ($1,$2,$3,'Widget','widget',10000,10000,20,5)`, [prodId, aid, catId]);

  const cats = await request(app).get("/api/categories");
  ok(cats.status === 200 && cats.body.categories.length === 1, "categories listed publicly");

  const bad = async (q: unknown, label: string) => {
    const r = await post("/api/cart/items", u).send({ productId: prodId, quantity: q });
    ok(r.status === 400, `${label} rejected (${r.status})`);
  };
  await bad(0, "quantity 0");
  await bad(-5, "negative quantity");
  await bad(1.5, "float quantity");
  await bad("2", "string quantity");
  await bad(Number.MAX_SAFE_INTEGER, "absurd quantity");
  const overLimit = await post("/api/cart/items", u).send({ productId: prodId, quantity: 6 });
  ok(overLimit.status === 409, `per-order limit enforced at cart (${overLimit.status})`);
  const withPrice = await post("/api/cart/items", u).send({ productId: prodId, quantity: 1, unitPricePaisa: 1 });
  ok(withPrice.status === 400, "cart rejects a client-supplied price (.strict)");
  const good = await post("/api/cart/items", u).send({ productId: prodId, quantity: 2 });
  ok(good.status === 201, `valid add succeeds (${good.status})`);

  const addr = await post("/api/addresses", u).send({
    recipientName: "Alice Smith", phone: "9800000000", street: "12 Lake Rd",
    city: "Kathmandu", state: "Bagmati", postalCode: "44600", country: "NP",
  });
  ok(addr.status === 201, `address created (${addr.status})`);
  const stored = await db.query(`SELECT recipient_name_encrypted, phone_encrypted, city FROM addresses WHERE user_id=$1`, [uid]);
  ok(!stored.rows[0].recipient_name_encrypted.includes("Alice"), "recipient name ENCRYPTED at rest");
  ok(!stored.rows[0].phone_encrypted.includes("9800000000"), "phone ENCRYPTED at rest");
  ok(stored.rows[0].city === "Kathmandu", "city kept plaintext (needed for shipping logic)");
  const readBack = await request(app).get("/api/addresses").set("Cookie", u.cookie);
  ok(readBack.body.addresses[0].recipientName === "Alice Smith", "owner sees decrypted PII");

  const victimAddrId = (await db.query(`SELECT id FROM addresses WHERE user_id=$1`, [uid])).rows[0].id;
  const delOther = await request(app).delete(`/api/addresses/${victimAddrId}`)
    .set("Cookie", a.cookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", a.token);
  ok(delOther.status === 404, `deleting another user's address => 404 (${delOther.status})`);

  const orderId = uuidv7(), itemId = uuidv7();
  await db.query(`INSERT INTO orders (id,user_id,order_no,ship_recipient_encrypted,ship_phone_encrypted,
    ship_street_encrypted,ship_city,ship_state,ship_postal_encrypted,ship_country,payment_method,
    subtotal_paisa,total_paisa,status) VALUES ($1,$2,'O-1','e','e','e','K','B','e','NP','CARD',10000,10000,'PAID')`,
    [orderId, uid]);
  await db.query(`INSERT INTO order_items (id,order_id,product_id,product_name,unit_price_paisa,
    original_price_paisa,quantity) VALUES ($1,$2,$3,'Widget',10000,10000,1)`, [itemId, orderId, prodId]);

  const notDelivered = await post("/api/reviews", u).send({ orderItemId: itemId, rating: 5, comment: "nice" });
  ok(notDelivered.status === 404, `review on a NON-DELIVERED order => 404 (${notDelivered.status})`);

  await db.query(`UPDATE orders SET status='DELIVERED' WHERE id=$1`, [orderId]);
  const reviewed = await post("/api/reviews", u)
    .send({ orderItemId: itemId, rating: 5, comment: `Great <script>alert(1)</script> product` });
  ok(reviewed.status === 201, `review allowed after DELIVERED (${reviewed.status})`);
  const storedReview = await db.query(`SELECT comment FROM reviews WHERE order_item_id=$1`, [itemId]);
  ok(!storedReview.rows[0].comment.includes("<script"), "review body SANITISED before storage");

  const dupe = await post("/api/reviews", u).send({ orderItemId: itemId, rating: 1 });
  ok(dupe.status === 409, `second review for the same order-item => 409 (${dupe.status})`);

  const otherUserReview = await post("/api/reviews", a).send({ orderItemId: itemId, rating: 5 });
  ok(otherUserReview.status === 404, "another user cannot review someone else's purchase");

  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#123456" } }).png().toBuffer();
  const asUser = await request(app).post(`/api/uploads/products/${prodId}/images`)
    .set("Cookie", u.cookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", u.token).attach("image", png, "p.png");
  ok(asUser.status === 404, `non-admin upload => 404 (${asUser.status})`);

  const asAdmin = await request(app).post(`/api/uploads/products/${prodId}/images`)
    .set("Cookie", a.cookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", a.token).attach("image", png, "p.png");
  ok(asAdmin.status === 201, `admin upload succeeds (${asAdmin.status})`);
  ok(/^[0-9a-f-]{36}\.webp$/i.test(asAdmin.body.storageKey), "stored under a UUID .webp key");

  const phpShell = Buffer.from("<?php system($_GET['c']); ?>");
  const shellUp = await request(app).post(`/api/uploads/products/${prodId}/images`)
    .set("Cookie", a.cookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin")
    .set("x-csrf-token", a.token).attach("image", phpShell, "shell.png");
  ok(shellUp.status === 400, `php-as-png rejected on magic bytes (${shellUp.status})`);

  const served = await request(app).get(`/api/uploads/${asAdmin.body.storageKey}`).set("Cookie", a.cookie);
  ok(served.status === 200, "uploaded image served via the authorised route");
  ok(served.headers["content-disposition"] === "attachment", "Content-Disposition: attachment");
  ok(served.headers["x-content-type-options"] === "nosniff", "nosniff on served upload");
  const traversal = await request(app).get("/api/uploads/..%2f..%2fetc%2fpasswd").set("Cookie", a.cookie);
  ok(traversal.status === 404, `path traversal on the object key => 404 (${traversal.status})`);

  const ssrf = await post("/api/uploads/products/image-from-url", a)
    .send({ url: "http://169.254.169.254/latest/meta-data/", productId: prodId });
  ok(ssrf.status === 400, `SSRF to cloud metadata blocked (${ssrf.status})`);
  const ssrfLocal = await post("/api/uploads/products/image-from-url", a)
    .send({ url: "http://127.0.0.1:55433/", productId: prodId });
  ok(ssrfLocal.status === 400, "SSRF to loopback blocked");
  const ssrfAudit = await db.query(`SELECT count(*)::int n FROM audit_log WHERE action='SSRF_BLOCKED'`);
  ok(ssrfAudit.rows[0].n >= 2, `SSRF attempts written to audit_log (${ssrfAudit.rows[0].n})`);

  const ai = await post("/api/ai/assistant", u).send({ question: "what shoes do you sell?" });
  ok([200, 502, 503].includes(ai.status), `AI answers only through the guard (${ai.status})`);
  if (ai.status === 200) {
    ok(ai.body?.aiGenerated === true, "a 200 from the assistant is a guarded response");
  }
  const aiLong = await post("/api/ai/assistant", u).send({ question: "x".repeat(5000) });
  ok(aiLong.status === 400, "over-long AI question rejected before any scan/model call");
  const aiExtra = await post("/api/ai/assistant", u).send({ question: "hi", model: "evil-model" });
  ok(aiExtra.status === 400, "client-supplied model id rejected (.strict) — model is pinned");

  await db.end(); await closeRateLimiter(); await closePool();
  console.log(`\nPorted routes E2E: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
