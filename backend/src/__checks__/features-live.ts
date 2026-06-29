import "./env";
import "dotenv/config";
import request from "supertest";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import { createApp } from "../app";
import { redisReady, closeRateLimiter } from "../security/rate-limit";
import { closePool } from "../db/client";
import { csvCell } from "../exports/csv";

const PG = () => new Client({ host: process.env.PGHOST ?? "127.0.0.1", port: Number(process.env.PGPORT ?? 55433),
  user: "migrator", password: process.env.PGPW_MIG, database: "ecommerce" });

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };
const ORIGIN = "http://localhost:5173";
const PW = "correct horse battery staple 3M!";

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
  await db.query(`TRUNCATE wishlist_items, wishlists, coupons, cart_items, carts, order_items, orders,
    products, categories, audit_log, sessions, accounts, verifications, users RESTART IDENTITY CASCADE`);

  ok(csvCell("=cmd|'/c calc'!A1").startsWith(`"'=`), "leading = escaped with quote");
  ok(csvCell("+SUM(A1)").startsWith(`"'+`), "leading + escaped");
  ok(csvCell("-2+3").startsWith(`"'-`), "leading - escaped");
  ok(csvCell("@SUM(A1)").startsWith(`"'@`), "leading @ escaped");
  ok(csvCell('normal, value "q"').includes('""q""'), "embedded quotes doubled");
  ok(csvCell("normal").startsWith('"n'), "normal value not prefixed");
  ok(!csvCell("plain").includes("'"), "plain value carries no injected quote");

  const mk = async (email: string, admin = false) => {
    await request(app).post("/api/auth/sign-up/email").set("Origin", ORIGIN).send({ email, password: PW, name: "U" });
    await db.query(`UPDATE users SET email_verified=true WHERE email=$1`, [email]);
    const id = (await db.query(`SELECT id FROM users WHERE email=$1`, [email])).rows[0].id;
    if (admin) await db.query(`UPDATE users SET role='ADMIN' WHERE id=$1`, [id]);
    const r = await request(app).post("/api/auth/sign-in/email").set("Origin", ORIGIN).send({ email, password: PW });
    const cookie = ((r.headers["set-cookie"] ?? []) as unknown as string[]).map(c => c.split(";")[0]).join("; ");
    const cr = await request(app).get("/api/csrf-token").set("Cookie", cookie);
    const cc = ((cr.headers["set-cookie"] ?? []) as unknown as string[]).map(c => c.split(";")[0]).join("; ");
    return { id, cookie: `${cookie}; ${cc}`, csrf: cr.body.csrfToken as string };
  };
  const alice = await mk(`al+${Date.now()}@lab.test`);
  const bob = await mk(`bo+${Date.now()}@lab.test`);
  const admin = await mk(`ad+${Date.now()}@lab.test`, true);
  const post = (p: string, c: { cookie: string; csrf: string }) =>
    request(app).post(p).set("Cookie", c.cookie).set("Origin", ORIGIN).set("Sec-Fetch-Site", "same-origin").set("x-csrf-token", c.csrf);

  const cat = uuidv7(), prod = uuidv7();
  await db.query(`INSERT INTO categories (id,name,slug) VALUES ($1,'C','c')`, [cat]);
  await db.query(`INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock)
                  VALUES ($1,$2,$3,$4,'w',1000,1000,9)`, [prod, admin.id, cat, "=HYPERLINK(\"http://evil\")"]);

  const add = await post("/api/wishlist/items", alice).send({ productId: prod });
  ok(add.status === 201, `add to wishlist (${add.status})`);
  const share = await post("/api/wishlist/share", alice).send({});
  ok(share.status === 200 && typeof share.body.shareToken === "string", "share returns an unguessable token");
  const token = share.body.shareToken as string;
  ok(token.length >= 24, "share token is long/random (not a row id)");

  const shared = await request(app).get(`/api/wishlist/shared/${token}`);
  ok(shared.status === 200 && shared.body.items.length === 1, "shared wishlist viewable by token");
  ok(!JSON.stringify(shared.body).includes(alice.id), "shared view does not leak the owner's id");

  const guess = await request(app).get(`/api/wishlist/shared/${"a".repeat(32)}`);
  ok(guess.status === 404, `guessed share token => 404 (${guess.status})`);

  const bobShareToken = "b".repeat(32);
  ok((await request(app).get(`/api/wishlist/shared/${bobShareToken}`)).status === 404, "no token → not shareable");

  const userCreatesCoupon = await post("/api/admin/coupons", alice).send({ code: "HACK", type: "FIXED", value: 100 });
  ok(userCreatesCoupon.status === 404, `non-admin coupon create => 404 (${userCreatesCoupon.status})`);
  const adminCreates = await post("/api/admin/coupons", admin).send({ code: "SAVE10", type: "PERCENT", value: 10 });
  ok(adminCreates.status === 201, `admin creates coupon (${adminCreates.status})`);
  const badPercent = await post("/api/admin/coupons", admin).send({ code: "BAD", type: "PERCENT", value: 250 });
  ok(badPercent.status === 400, "PERCENT > 100 rejected");
  const extraField = await post("/api/admin/coupons", admin).send({ code: "X", type: "FIXED", value: 1, timesRedeemed: 999 });
  ok(extraField.status === 400, "unknown field (timesRedeemed) rejected by .strict()");

  const csv = await request(app).get("/api/admin/products.csv").set("Cookie", admin.cookie);
  ok(csv.status === 200, `csv export (${csv.status})`);
  ok(csv.headers["content-type"]?.includes("text/csv"), "csv content-type");
  ok(csv.text.includes(`"'=HYPERLINK`), "product name formula neutralised with leading quote in CSV");
  ok(!/\n=HYPERLINK/.test(csv.text) && !/,=HYPERLINK/.test(csv.text), "no un-escaped =HYPERLINK cell in the CSV");

  await db.end(); await closeRateLimiter(); await closePool();
  console.log(`\nFeatures E2E (wishlist/coupon/csv): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
