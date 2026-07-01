
import "./env";
import "dotenv/config";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import { checkout } from "../checkout/checkout";
import { closePool } from "../db/client";
import { encrypt } from "../security/crypto";
import { DEMO, enabledFlags } from "../security/demo-flags";

const PG = () => new Client({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55433),
  user: "migrator", password: process.env.PGPW_MIG, database: "ecommerce",
});

const N = 25;

async function main() {
  const insecure = DEMO.NON_ATOMIC_STOCK;
  console.log(`mode: ${insecure ? "INSECURE (NON_ATOMIC_STOCK=true)" : "SECURE (default)"}`);
  console.log(`flags enabled: ${enabledFlags().map(f => f.key).join(", ") || "(none)"}\n`);

  const db = PG(); await db.connect();
  await db.query(`TRUNCATE coupon_redemptions, coupons, order_status_history, order_items, orders,
    cart_items, carts, addresses, reviews, payments, product_images, products, categories,
    audit_log, idempotency_keys, users RESTART IDENTITY CASCADE`);

  const ADMIN = uuidv7(), CAT = uuidv7(), SCARCE = uuidv7();
  await db.query(`INSERT INTO users (id,name,email,role) VALUES ($1,'Ad','ad@lab.test','ADMIN')`, [ADMIN]);
  await db.query(`INSERT INTO categories (id,name,slug) VALUES ($1,'C','c')`, [CAT]);
  await db.query(`INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock)
                  VALUES ($1,$2,$3,'LastOne','lastone',50000,50000,1)`, [SCARCE, ADMIN, CAT]);

  const racers: Array<{ actor: { id: string; role: "USER" }; addr: string }> = [];
  for (let i = 0; i < N; i++) {
    const uid = uuidv7(), aid = uuidv7(), cid = uuidv7();
    await db.query(`INSERT INTO users (id,name,email,role) VALUES ($1,$2,$3,'USER')`, [uid, `R${i}`, `r${i}@lab.test`]);
    await db.query(`INSERT INTO addresses (id,user_id,recipient_name_encrypted,phone_encrypted,
      street_encrypted,city,state,postal_code_encrypted,country) VALUES ($1,$2,$3,$4,$5,'K','B',$6,'NP')`,
      [aid, uid, encrypt("R","pii:address"), encrypt("9","pii:phone"), encrypt("S","pii:address"), encrypt("4","pii:address")]);
    await db.query(`INSERT INTO carts (id,user_id) VALUES ($1,$2)`, [cid, uid]);
    await db.query(`INSERT INTO cart_items (id,cart_id,product_id,quantity) VALUES ($1,$2,$3,1)`, [uuidv7(), cid, SCARCE]);
    racers.push({ actor: { id: uid, role: "USER" }, addr: aid });
  }

  const results = await Promise.all(racers.map(r =>
    checkout(r.actor, { addressId: r.addr, paymentMethod: "CARD" }).then(() => "ok").catch(() => "rejected")));

  const wins = results.filter(r => r === "ok").length;
  const stock = Number((await db.query(`SELECT stock FROM products WHERE id=$1`, [SCARCE])).rows[0].stock);
  const sold = Number((await db.query(`SELECT COALESCE(SUM(quantity),0)::int s FROM order_items WHERE product_id=$1`, [SCARCE])).rows[0].s);

  console.log(`concurrent checkouts : ${N}`);
  console.log(`succeeded            : ${wins}`);
  console.log(`units actually sold  : ${sold}`);
  console.log(`final stock          : ${stock}`);

  let verdict: string;
  if (!insecure) {
    verdict = wins === 1 && sold === 1 && stock === 0
      ? "PASS — control holds: exactly one buyer got the last unit"
      : `FAIL — SECURE PATH OVERSOLD (${sold} units from 1 in stock)`;
  } else {
    verdict = sold > 1
      ? `DEMONSTRATED — insecure path OVERSOLD ${sold} units from 1 in stock`
      : `NOT DEMONSTRATED — insecure path still sold ${sold}; the demo flag did not change behaviour`;
  }
  console.log(`\n${verdict}`);

  await db.end(); await closePool();
  const good = insecure ? sold > 1 : (wins === 1 && sold === 1 && stock === 0);
  process.exit(good ? 0 : 1);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
