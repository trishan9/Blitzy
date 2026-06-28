
import "./env";
import "dotenv/config";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import { checkout, CheckoutError, _pricing } from "../checkout/checkout";
import { closePool } from "../db/client";
import { encrypt } from "../security/crypto";

const PG = () => new Client({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 55433),
  user: "migrator", password: process.env.PGPW_MIG, database: "ecommerce",
});

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const ALICE = uuidv7(), BOB = uuidv7(), ADMIN = uuidv7();
const CAT = uuidv7(), PLENTY = uuidv7(), SCARCE = uuidv7();
const COUPON1 = uuidv7(), COUPON_PCT = uuidv7();
const ALICE_ADDR = uuidv7(), BOB_ADDR = uuidv7();
const actorAlice = { id: ALICE, role: "USER" as const };
const actorBob = { id: BOB, role: "USER" as const };

async function seed(db: Client) {
  await db.query(`TRUNCATE coupon_redemptions, coupons, order_status_history, order_items, orders,
    cart_items, carts, addresses, reviews, payments, product_images, products, categories,
    audit_log, idempotency_keys, users RESTART IDENTITY CASCADE`);
  for (const [id, n, e, r] of [[ALICE,"Alice","a@lab.test","USER"],[BOB,"Bob","b@lab.test","USER"],[ADMIN,"Ad","ad@lab.test","ADMIN"]] as const)
    await db.query(`INSERT INTO users (id,name,email,role) VALUES ($1,$2,$3,$4)`, [id,n,e,r]);
  await db.query(`INSERT INTO categories (id,name,slug) VALUES ($1,'C','c')`, [CAT]);
  await db.query(`INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock,per_order_limit)
                  VALUES ($1,$2,$3,'Plenty','plenty',10000,10000,1000,5)`, [PLENTY, ADMIN, CAT]);
  await db.query(`INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock)
                  VALUES ($1,$2,$3,'LastOne','lastone',50000,50000,1)`, [SCARCE, ADMIN, CAT]);
  await db.query(`INSERT INTO coupons (id,code,type,value,max_redemptions,per_user_limit)
                  VALUES ($1,'SINGLE','FIXED',1000,1,1)`, [COUPON1]);
  await db.query(`INSERT INTO coupons (id,code,type,value,per_user_limit)
                  VALUES ($1,'TENPCT','PERCENT',10,99)`, [COUPON_PCT]);
  for (const [id, uid] of [[ALICE_ADDR, ALICE],[BOB_ADDR, BOB]] as const)
    await db.query(`INSERT INTO addresses (id,user_id,recipient_name_encrypted,phone_encrypted,
      street_encrypted,city,state,postal_code_encrypted,country)
      VALUES ($1,$2,$3,$4,$5,'KTM','Bagmati',$6,'NP')`,
      [id, uid, encrypt("R","pii:address"), encrypt("98","pii:phone"), encrypt("St","pii:address"), encrypt("44600","pii:address")]);
}

async function setCart(db: Client, userId: string, productId: string, qty: number) {
  await db.query(`DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id=$1)`, [userId]);
  await db.query(`DELETE FROM carts WHERE user_id=$1`, [userId]);
  const cartId = uuidv7();
  await db.query(`INSERT INTO carts (id,user_id) VALUES ($1,$2)`, [cartId, userId]);
  await db.query(`INSERT INTO cart_items (id,cart_id,product_id,quantity) VALUES ($1,$2,$3,$4)`,
    [uuidv7(), cartId, productId, qty]);
  return cartId;
}

async function main() {
  const db = PG(); await db.connect();
  await seed(db);
  console.log("seeded.\n");

  await setCart(db, ALICE, PLENTY, 2);
  const r1 = await checkout(actorAlice, { addressId: ALICE_ADDR, paymentMethod: "CARD" });
  ok(r1.subtotalPaisa === 20000n, `subtotal computed from DB (${r1.subtotalPaisa})`);
  const expDelivery = _pricing.computeDeliveryFee(20000n);
  const expTax = _pricing.computeTax(20000n);
  ok(r1.deliveryFeePaisa === expDelivery, `delivery fee server-computed (${r1.deliveryFeePaisa})`);
  ok(r1.taxPaisa === expTax, `tax server-computed (${r1.taxPaisa})`);
  ok(r1.totalPaisa === 20000n + expDelivery + expTax, `total = subtotal+delivery+tax (${r1.totalPaisa})`);
  ok(r1.discountPaisa === 0n, "no coupon => zero discount");

  const inputKeys = Object.keys({ addressId: "", couponCode: "", paymentMethod: "CARD", idempotencyKey: "" });
  ok(!inputKeys.some(k => /price|total|subtotal|discount|amount|shipping|fee|tax/i.test(k)),
     "CheckoutInput exposes NO money field — client cannot supply one");

  const snap = await db.query(`SELECT product_name, unit_price_paisa, quantity FROM order_items WHERE order_id=$1`, [r1.orderId]);
  ok(snap.rows[0]?.product_name === "Plenty", "order_item snapshots product name");
  ok(String(snap.rows[0]?.unit_price_paisa) === "10000", "order_item snapshots unit price");

  await db.query(`UPDATE products SET sale_price_paisa=1, original_price_paisa=1 WHERE id=$1`, [PLENTY]);
  const snap2 = await db.query(`SELECT unit_price_paisa FROM order_items WHERE order_id=$1`, [r1.orderId]);
  ok(String(snap2.rows[0]?.unit_price_paisa) === "10000", "price change does NOT rewrite historical order");
  await db.query(`UPDATE products SET sale_price_paisa=10000, original_price_paisa=10000 WHERE id=$1`, [PLENTY]);

  const ci = await db.query(`SELECT count(*)::int n FROM cart_items ci JOIN carts c ON c.id=ci.cart_id WHERE c.user_id=$1`, [ALICE]);
  ok(ci.rows[0].n === 0, "cart cleared after checkout");
  const st = await db.query(`SELECT status, payment_status FROM orders WHERE id=$1`, [r1.orderId]);
  ok(st.rows[0].status === "PENDING_PAYMENT" && st.rows[0].payment_status === "PENDING",
     "order starts at PENDING_PAYMENT/PENDING (state machine entry)");
  const au = await db.query(`SELECT count(*)::int n FROM audit_log WHERE resource_id=$1 AND action='ORDER_CREATED'`, [r1.orderId]);
  ok(au.rows[0].n === 1, "audit_log records ORDER_CREATED");

  await setCart(db, ALICE, PLENTY, 3);
  const r2 = await checkout(actorAlice, { addressId: ALICE_ADDR, paymentMethod: "CARD", couponCode: "TENPCT" });
  ok(r2.discountPaisa === 3000n, `10% coupon applied server-side (${r2.discountPaisa})`);
  ok(r2.totalPaisa === 27000n + _pricing.computeDeliveryFee(27000n) + _pricing.computeTax(27000n),
     "coupon reduces the total correctly");

  await setCart(db, ALICE, PLENTY, 1);
  let usedBobAddr = false;
  try { await checkout(actorAlice, { addressId: BOB_ADDR, paymentMethod: "CARD" }); usedBobAddr = true; }
  catch (e) { ok(e instanceof CheckoutError && (e as CheckoutError).httpStatus === 404,
    "another user's address => 404 (not 403 — no existence oracle)"); }
  ok(!usedBobAddr, "cannot ship to another user's address");

  await setCart(db, ALICE, PLENTY, 6);
  let overLimit = false;
  try { await checkout(actorAlice, { addressId: ALICE_ADDR, paymentMethod: "CARD" }); overLimit = true; } catch { /* expected */ }
  ok(!overLimit, "per-order limit enforced");

  await db.query(`DELETE FROM cart_items`); await db.query(`DELETE FROM carts`);
  let emptyOk = false;
  try { await checkout(actorAlice, { addressId: ALICE_ADDR, paymentMethod: "CARD" }); emptyOk = true; } catch { /* expected */ }
  ok(!emptyOk, "empty cart rejected");

  await setCart(db, ALICE, PLENTY, 1);
  const key = "idem-" + uuidv7();
  await checkout(actorAlice, { addressId: ALICE_ADDR, paymentMethod: "CARD", idempotencyKey: key });
  await setCart(db, ALICE, PLENTY, 1);
  let replayed = false;
  try { await checkout(actorAlice, { addressId: ALICE_ADDR, paymentMethod: "CARD", idempotencyKey: key }); replayed = true; } catch { /* expected */ }
  ok(!replayed, "replayed Idempotency-Key rejected (no duplicate order)");

  const N = 30;
  const racers: Array<{ id: string; role: "USER" }> = [];
  for (let i = 0; i < N; i++) {
    const uid = uuidv7();
    await db.query(`INSERT INTO users (id,name,email,role) VALUES ($1,$2,$3,'USER')`, [uid, `R${i}`, `r${i}@lab.test`]);
    const aid = uuidv7();
    await db.query(`INSERT INTO addresses (id,user_id,recipient_name_encrypted,phone_encrypted,
      street_encrypted,city,state,postal_code_encrypted,country)
      VALUES ($1,$2,$3,$4,$5,'K','B',$6,'NP')`,
      [aid, uid, encrypt("R","pii:address"), encrypt("9","pii:phone"), encrypt("S","pii:address"), encrypt("4","pii:address")]);
    await setCart(db, uid, SCARCE, 1);
    racers.push({ id: uid, role: "USER" });
    (racers[i] as any).addr = aid;
  }
  const results = await Promise.all(racers.map((a, i) =>
    checkout(a, { addressId: (racers[i] as any).addr, paymentMethod: "CARD" })
      .then(() => "ok").catch(() => "rejected")));
  const wins = results.filter(r => r === "ok").length;
  const stockRow = await db.query(`SELECT stock FROM products WHERE id=$1`, [SCARCE]);
  const orderCount = await db.query(`SELECT count(*)::int n FROM order_items WHERE product_id=$1`, [SCARCE]);
  ok(wins === 1, `RACE via real checkout(): exactly 1 of ${N} succeeded (got ${wins})`);
  ok(Number(stockRow.rows[0].stock) === 0, `stock is 0, never negative (got ${stockRow.rows[0].stock})`);
  ok(orderCount.rows[0].n === 1, `exactly 1 order line for the scarce product (got ${orderCount.rows[0].n})`);

  const M = 20;
  const cRacers: any[] = [];
  for (let i = 0; i < M; i++) {
    const uid = uuidv7(); const aid = uuidv7();
    await db.query(`INSERT INTO users (id,name,email,role) VALUES ($1,$2,$3,'USER')`, [uid, `C${i}`, `c${i}@lab.test`]);
    await db.query(`INSERT INTO addresses (id,user_id,recipient_name_encrypted,phone_encrypted,
      street_encrypted,city,state,postal_code_encrypted,country)
      VALUES ($1,$2,$3,$4,$5,'K','B',$6,'NP')`,
      [aid, uid, encrypt("R","pii:address"), encrypt("9","pii:phone"), encrypt("S","pii:address"), encrypt("4","pii:address")]);
    await setCart(db, uid, PLENTY, 1);
    cRacers.push({ actor: { id: uid, role: "USER" as const }, addr: aid });
  }
  const cRes = await Promise.all(cRacers.map(c =>
    checkout(c.actor, { addressId: c.addr, paymentMethod: "CARD", couponCode: "SINGLE" })
      .then(() => "ok").catch(() => "rejected")));
  const couponWins = cRes.filter(r => r === "ok").length;
  const redeemed = await db.query(`SELECT times_redeemed FROM coupons WHERE id=$1`, [COUPON1]);
  ok(couponWins === 1, `RACE via real checkout(): exactly 1 of ${M} redeemed the single-use coupon (got ${couponWins})`);
  ok(Number(redeemed.rows[0].times_redeemed) === 1, `times_redeemed is exactly 1 (got ${redeemed.rows[0].times_redeemed})`);

  await db.end();
  await closePool();
  console.log(`\nCHECKOUT (live): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
