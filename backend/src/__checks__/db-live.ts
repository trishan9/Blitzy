
import "./env";
import { Client, Pool } from "pg";
import { uuidv7 } from "uuidv7";

const HOST = process.env.PGHOST ?? "127.0.0.1";
const PORT = Number(process.env.PGPORT ?? 55433);
const DB = "ecommerce";

const asMigrator = () => new Client({ host: HOST, port: PORT, user: "migrator", password: process.env.PGPW_MIG ?? "migpass", database: DB });
const appPool = new Pool({ host: HOST, port: PORT, user: "app_rw", password: process.env.PGPW_RW ?? "rwpass", database: DB, max: 60 });

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

async function withActor(actorId: string, role: string, fn: (c: any) => Promise<any>): Promise<any> {
  const c = await appPool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.actor_id',$1,true), set_config('app.actor_role',$2,true)", [actorId, role]);
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
  finally { c.release(); }
}

const ALICE = uuidv7(), BOB = uuidv7(), ADMIN = uuidv7();
const CAT = uuidv7(), PROD = uuidv7(), SCARCE = uuidv7(), COUPON = uuidv7();
const ALICE_ORDER = uuidv7(), BOB_ORDER = uuidv7();

async function seed() {
  const m = asMigrator();
  await m.connect();
  await m.query("BEGIN");
  await m.query(`TRUNCATE coupon_redemptions, coupons, order_status_history, order_items, orders,
                 cart_items, carts, addresses, reviews, payments, product_images, products,
                 categories, audit_log, users RESTART IDENTITY CASCADE`);
  for (const [id, name, email, role] of [
    [ALICE, "Alice", "alice@lab.test", "USER"], [BOB, "Bob", "bob@lab.test", "USER"], [ADMIN, "Admin", "admin@lab.test", "ADMIN"],
  ] as const) {
    await m.query(`INSERT INTO users (id,name,email,role) VALUES ($1,$2,$3,$4)`, [id, name, email, role]);
  }
  await m.query(`INSERT INTO categories (id,name,slug) VALUES ($1,'Cat','cat')`, [CAT]);
  await m.query(
    `INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock)
     VALUES ($1,$2,$3,'Widget','widget',10000,10000,100)`, [PROD, ADMIN, CAT]);
  await m.query(
    `INSERT INTO products (id,user_id,category_id,name,slug,original_price_paisa,sale_price_paisa,stock)
     VALUES ($1,$2,$3,'LastOne','lastone',50000,50000,1)`, [SCARCE, ADMIN, CAT]);
  await m.query(
    `INSERT INTO coupons (id,code,type,value,max_redemptions,per_user_limit)
     VALUES ($1,'SINGLE','FIXED',1000,1,1)`, [COUPON]);
  for (const [oid, uid, no] of [[ALICE_ORDER, ALICE, "A-1"], [BOB_ORDER, BOB, "B-1"]] as const) {
    await m.query(
      `INSERT INTO orders (id,user_id,order_no,ship_recipient_encrypted,ship_phone_encrypted,
        ship_street_encrypted,ship_city,ship_state,ship_postal_encrypted,ship_country,
        payment_method,subtotal_paisa,total_paisa)
       VALUES ($1,$2,$3,'e','e','e','KTM','Bagmati','e','NP','CARD',10000,10000)`, [oid, uid, no]);
  }
  await m.query("COMMIT");
  await m.end();
}

async function main() {
  await seed();
  console.log("seeded.\n");

  const aliceSees = await withActor(ALICE, "USER", (c) => c.query("SELECT id FROM orders"));
  ok(aliceSees.rowCount === 1 && aliceSees.rows[0].id === ALICE_ORDER, "RLS: alice sees ONLY her own order");

  const bobSees = await withActor(BOB, "USER", (c) => c.query("SELECT id FROM orders"));
  ok(bobSees.rowCount === 1 && bobSees.rows[0].id === BOB_ORDER, "RLS: bob sees ONLY his own order");

  const idor = await withActor(ALICE, "USER", (c) => c.query("SELECT id FROM orders WHERE id=$1", [BOB_ORDER]));
  ok(idor.rowCount === 0, "RLS: IDOR by explicit id returns 0 rows (not 403 — nothing exists to alice)");

  const adminSees = await withActor(ADMIN, "ADMIN", (c) => c.query("SELECT id FROM orders"));
  ok(adminSees.rowCount === 2, "RLS: admin sees all orders");

  const anon = await appPool.query("SELECT id FROM orders");
  ok(anon.rowCount === 0, "RLS: no actor context => no rows");

  let wroteForBob = false;
  try {
    await withActor(ALICE, "USER", (c) => c.query(
      `INSERT INTO orders (id,user_id,order_no,ship_recipient_encrypted,ship_phone_encrypted,
        ship_street_encrypted,ship_city,ship_state,ship_postal_encrypted,ship_country,
        payment_method,subtotal_paisa,total_paisa)
       VALUES ($1,$2,'X-1','e','e','e','K','B','e','NP','CARD',1,1)`, [uuidv7(), BOB]));
    wroteForBob = true;
  } catch {  }
  ok(!wroteForBob, "RLS WITH CHECK: alice cannot create an order owned by bob");

  let ddl = false;
  try { await appPool.query("CREATE TABLE evil (id int)"); ddl = true; } catch {  }
  ok(!ddl, "app_rw cannot DDL (CREATE TABLE denied)");

  let dropped = false;
  try { await appPool.query("DROP TABLE orders"); dropped = true; } catch {  }
  ok(!dropped, "app_rw cannot DROP TABLE");

  await appPool.query("INSERT INTO audit_log (id,action) VALUES ($1,'TEST')", [uuidv7()]);
  ok(true, "audit_log: app_rw can INSERT");
  let mutated = false;
  try { await appPool.query("UPDATE audit_log SET action='TAMPERED'"); mutated = true; } catch {  }
  ok(!mutated, "audit_log: app_rw cannot UPDATE (append-only)");
  let delAudit = false;
  try { await appPool.query("DELETE FROM audit_log"); delAudit = true; } catch {  }
  ok(!delAudit, "audit_log: app_rw cannot DELETE (trail cannot be erased)");

  const m2 = asMigrator(); await m2.connect();
  const rejects = async (sql: string, params: any[], label: string) => {
    try { await m2.query(sql, params); ok(false, label + " should be rejected"); }
    catch { ok(true, label); }
  };
  await rejects(`UPDATE products SET stock = -1 WHERE id=$1`, [PROD], "CHECK: stock cannot go negative");
  await rejects(`UPDATE orders SET total_paisa = -1 WHERE id=$1`, [ALICE_ORDER], "CHECK: total cannot be negative");
  await rejects(`UPDATE orders SET discount_paisa = 999999 WHERE id=$1`, [ALICE_ORDER], "CHECK: discount cannot exceed subtotal");
  await rejects(`UPDATE products SET sale_price_paisa = 99999999 WHERE id=$1`, [PROD], "CHECK: sale price cannot exceed original");
  await rejects(`INSERT INTO reviews (id,user_id,order_id,order_item_id,product_id,rating)
                 VALUES ($1,$2,$3,$4,$5,9)`, [uuidv7(), ALICE, ALICE_ORDER, uuidv7(), PROD], "CHECK: rating must be 1..5");

  const N = 50;
  const attempts = Array.from({ length: N }, () =>
    appPool.query(`UPDATE products SET stock = stock - 1 WHERE id=$1 AND stock >= 1 RETURNING stock`, [SCARCE])
      .then((r) => r.rowCount === 1).catch(() => false)
  );
  const wins = (await Promise.all(attempts)).filter(Boolean).length;
  const finalStock = (await m2.query("SELECT stock FROM products WHERE id=$1", [SCARCE])).rows[0].stock;
  ok(wins === 1, `RACE: exactly 1 of ${N} concurrent checkouts won the last unit (got ${wins})`);
  ok(finalStock === 0, `RACE: final stock is 0, never negative (got ${finalStock})`);

  const M = 20;
  const redemptions = Array.from({ length: M }, () =>
    appPool.query(`INSERT INTO coupon_redemptions (id,coupon_id,user_id) VALUES ($1,$2,$3)`, [uuidv7(), COUPON, ALICE])
      .then(() => true).catch(() => false)
  );
  const redeemed = (await Promise.all(redemptions)).filter(Boolean).length;
  ok(redeemed === 1, `RACE: exactly 1 of ${M} concurrent redemptions succeeded (got ${redeemed})`);

  const st = await appPool.query("SHOW statement_timeout");
  ok(st.rows[0].statement_timeout === "5s", `app_rw statement_timeout = 5s (got ${st.rows[0].statement_timeout})`);
  let slept = false;
  try { await appPool.query("SELECT pg_sleep(10)"); slept = true; } catch { /* expected: timeout */ }
  ok(!slept, "statement_timeout kills a 10s sleep (time-based blind SQLi oracle denied)");

  await m2.end();
  await appPool.end();
  console.log(`\nLIVE DB verification: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
