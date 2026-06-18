
import "dotenv/config";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import { passwordHasher } from "../auth/argon2";
import { encrypt } from "../security/crypto";
import { sanitiseProse } from "../security/sanitise";

export const SEED_PASSWORD = "Nepal@Shop2026!";

const USERS = [
  { name: "Aarati Sharma",   email: "aarati@shop.test",  role: "USER"  as const, city: "Kathmandu" },
  { name: "Bibek Gurung",    email: "bibek@shop.test",   role: "USER"  as const, city: "Pokhara"   },
  { name: "Sunita Rai",      email: "sunita@shop.test",  role: "USER"  as const, city: "Lalitpur"  },
  { name: "Prakash Thapa",   email: "prakash@shop.test", role: "USER"  as const, city: "Bhaktapur" },
  { name: "Manisha Adhikari",email: "manisha@shop.test", role: "USER"  as const, city: "Biratnagar"},
  { name: "Store Admin",     email: "admin@shop.test",   role: "ADMIN" as const, city: "Kathmandu" },
];

const REVIEWS: Record<string, { by: string; rating: number; comment: string }[]> = {
  "fresh-apples": [
    { by: "aarati@shop.test", rating: 5, comment: "Really crisp and fresh. Delivered next morning and every apple was firm — no bruises at all." },
    { by: "bibek@shop.test",  rating: 4, comment: "Good quality for the price. A couple were smaller than expected but the taste was excellent." },
  ],
  "organic-bananas": [
    { by: "sunita@shop.test", rating: 5, comment: "Perfectly ripe, not overripe like the ones I get locally. My kids finished the whole dozen in two days." },
    { by: "prakash@shop.test",rating: 4, comment: "Sweet and fresh. Lasted about 4 days before turning. Would order again." },
  ],
  "whole-wheat-bread": [
    { by: "manisha@shop.test",rating: 5, comment: "Soft and genuinely fresh — you can smell it through the packaging. Great for morning toast." },
    { by: "aarati@shop.test", rating: 3, comment: "Taste is good but it went stale faster than I expected. Buy only if finishing within 2 days." },
  ],
  "butter-croissant": [
    { by: "bibek@shop.test",  rating: 5, comment: "Flaky and buttery, tastes bakery-fresh. Reheated for 3 minutes and it was perfect." },
  ],
  "orange-juice": [
    { by: "sunita@shop.test", rating: 4, comment: "No added sugar and you can tell. Slightly tangy which I like, though not everyone will." },
    { by: "manisha@shop.test",rating: 5, comment: "Best packaged juice I've had here. Worth the price during the discount." },
  ],
  "basmati-rice": [
    { by: "prakash@shop.test",rating: 5, comment: "Long grains, cooks separate, and the aroma is proper aged basmati. 5kg pack lasts our family a month." },
    { by: "aarati@shop.test", rating: 5, comment: "Excellent quality. Have ordered this three times now, consistent every time." },
  ],
  "extra-virgin-olive-oil": [
    { by: "bibek@shop.test",  rating: 4, comment: "Good peppery finish, clearly not cut with other oils. Bottle is sturdy and sealed well." },
  ],
  "atlantic-salmon-fillet": [
    { by: "manisha@shop.test",rating: 5, comment: "Arrived properly frozen with cold packs. Clean smell, no fishiness — pan seared beautifully." },
    { by: "sunita@shop.test", rating: 4, comment: "Quality is very good. Pricey but for salmon in Kathmandu this is fair." },
  ],
  "salted-potato-chips": [
    { by: "prakash@shop.test",rating: 4, comment: "Proper kettle crunch, not too oily. Salt level is just right." },
  ],
  "aloe-vera-body-wash": [
    { by: "aarati@shop.test", rating: 5, comment: "Gentle and doesn't dry my skin like the sulphate ones. Mild scent that fades quickly." },
    { by: "bibek@shop.test",  rating: 3, comment: "Works fine but lathers less than I'm used to. Takes a bit more product per wash." },
  ],
  "green-tea": [
    { by: "sunita@shop.test", rating: 5, comment: "Whole leaf, not dust. Brews clean without bitterness even if you steep a little long." },
  ],
  "baby-wipes": [
    { by: "manisha@shop.test",rating: 5, comment: "Thick, genuinely fragrance-free, and no reaction on my daughter's skin. Buying in bulk now." },
  ],
  "baby-spinach": [
    { by: "aarati@shop.test", rating: 4, comment: "Leaves were clean and crisp, barely any stems to pick out. Wilted a bit by day three so use it early." },
    { by: "prakash@shop.test",rating: 5, comment: "Much better than the loose spinach at the market — washed, packed properly, and no grit at all." },
  ],
  "dark-chocolate-cookies": [
    { by: "bibek@shop.test",  rating: 5, comment: "Actually tastes like 70% cocoa, not sugar pretending to be chocolate. Crunchy edge with a soft centre." },
    { by: "manisha@shop.test",rating: 4, comment: "Very good but quite rich — two is plenty. Pack was sealed well, nothing broken in transit." },
  ],
  "free-range-chicken-breast": [
    { by: "sunita@shop.test", rating: 5, comment: "Arrived cold and properly sealed. Firm texture, no water weight when cooked — you can tell the difference." },
    { by: "aarati@shop.test", rating: 4, comment: "Good quality meat, trimmed neatly. Costs more than regular chicken but the texture justifies it." },
  ],
  "mixed-berry-medley": [
    { by: "prakash@shop.test",rating: 4, comment: "Frozen solid on arrival, no clumping, which usually means it hasn't thawed on the way. Great in smoothies." },
    { by: "bibek@shop.test",  rating: 5, comment: "Good mix — more blueberries than filler strawberries, unlike other brands I've tried." },
  ],
  "seasonal-mango-crate": [
    { by: "manisha@shop.test",rating: 5, comment: "Ordered for Dashain and they ripened perfectly over four days. Sweet right to the stone." },
    { by: "sunita@shop.test", rating: 4, comment: "Two out of the crate were bruised but the rest were excellent. Support refunded those without argument." },
  ],
  "limited-edition-hamper": [
    { by: "aarati@shop.test", rating: 5, comment: "Gave this as a gift and the presentation was genuinely nice. Everything inside was well within date." },
  ],
};

async function main() {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL not set — run scripts/setup.sh first");
  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    await db.query("BEGIN");

    await db.query(`DELETE FROM reviews`);
    await db.query(`DELETE FROM order_status_history`);
    await db.query(`DELETE FROM order_items`);
    await db.query(`DELETE FROM orders`);
    await db.query(`DELETE FROM addresses`);
    await db.query(`DELETE FROM accounts WHERE provider_id='credential'`);
    await db.query(`DELETE FROM users WHERE email = ANY($1)`, [USERS.map((u) => u.email)]);

    const hash = await passwordHasher.hash(SEED_PASSWORD);
    const ids = new Map<string, string>();
    for (const u of USERS) {
      const id = uuidv7();
      ids.set(u.email, id);
      await db.query(
        `INSERT INTO users (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)`,
        [id, u.name, u.email, u.role]
      );
      await db.query(
        `INSERT INTO accounts (id,user_id,account_id,provider_id,password)
         VALUES ($1,$2,$3,'credential',$4)`,
        [uuidv7(), id, u.email, hash]
      );
      await db.query(
        `INSERT INTO addresses (id,user_id,recipient_name_encrypted,phone_encrypted,street_encrypted,
           city,state,postal_code_encrypted,country,is_default)
         VALUES ($1,$2,$3,$4,$5,$6,'Bagmati',$7,'NP',true)`,
        [uuidv7(), id, encrypt(u.name, "pii:address"), encrypt("98" + Math.floor(10000000 + Math.random() * 89999999), "pii:phone"),
         encrypt("Ward 5, Main Road", "pii:address"), u.city, encrypt("44600", "pii:address")]
      );
    }
    console.log(`  ${USERS.length} users (+credential accounts, +addresses)`);

    let orderCount = 0, reviewCount = 0;
    for (const [slug, list] of Object.entries(REVIEWS)) {
      const prod = (await db.query(
        `SELECT p.id, p.name, p.sale_price_paisa,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image_url
           FROM products p WHERE p.slug=$1 LIMIT 1`, [slug]
      )).rows[0];
      if (!prod) { console.warn(`  ! no product for slug ${slug} — skipped`); continue; }

      for (const r of list) {
        const userId = ids.get(r.by);
        if (!userId) continue;

        const orderId = uuidv7(), itemId = uuidv7();
        const qty = 1 + Math.floor(Math.random() * 2);
        const sub = BigInt(prod.sale_price_paisa) * BigInt(qty);
        const tax = (sub * 1300n) / 10000n;
        const delivery = sub >= 100000n ? 0n : 5000n;

        await db.query(
          `INSERT INTO orders (id,user_id,order_no,ship_recipient_encrypted,ship_phone_encrypted,
             ship_street_encrypted,ship_city,ship_state,ship_postal_encrypted,ship_country,
             payment_method,payment_status,status,subtotal_paisa,discount_paisa,
             delivery_fee_paisa,tax_paisa,total_paisa,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'Kathmandu','Bagmati',$7,'NP','CARD','PAID','DELIVERED',
                   $8,0,$9,$10,$11, now() - ($12 || ' days')::interval)`,
          [orderId, userId, `ORD-${Date.now().toString(36).toUpperCase()}-${orderCount}`,
           encrypt("Recipient", "pii:address"), encrypt("9800000000", "pii:phone"),
           encrypt("Ward 5, Main Road", "pii:address"), encrypt("44600", "pii:address"),
           sub.toString(), delivery.toString(), tax.toString(), (sub + delivery + tax).toString(),
           String(3 + Math.floor(Math.random() * 40))]
        );
        await db.query(
          `INSERT INTO order_items (id,order_id,product_id,product_name,image_url,unit_price_paisa,
             original_price_paisa,discount_percent,quantity,is_reviewed)
           VALUES ($1,$2,$3,$4,$5,$6,$6,0,$7,true)`,
          [itemId, orderId, prod.id, prod.name, prod.image_url ?? null, prod.sale_price_paisa, qty]
        );
        await db.query(
          `INSERT INTO order_status_history (id,order_id,status,note) VALUES ($1,$2,'DELIVERED','seeded')`,
          [uuidv7(), orderId]
        );
        orderCount++;

        await db.query(
          `INSERT INTO reviews (id,user_id,order_id,order_item_id,product_id,rating,comment,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' days')::interval)`,
          [uuidv7(), userId, orderId, itemId, prod.id, r.rating, sanitiseProse(r.comment),
           String(1 + Math.floor(Math.random() * 30))]
        );
        reviewCount++;
      }

      await db.query(
        `UPDATE products p SET
           review_count = s.n,
           rating_average_milli = s.avg_milli
         FROM (SELECT product_id, count(*)::int n, (avg(rating)*1000)::int avg_milli
               FROM reviews WHERE product_id=$1 GROUP BY product_id) s
         WHERE p.id = s.product_id`, [prod.id]
      );
    }
    console.log(`  ${orderCount} delivered orders, ${reviewCount} reviews (ratings recomputed)`);

    await db.query("COMMIT");

    console.log("\n  Login credentials (all share one password):");
    console.log(`    password: ${SEED_PASSWORD}`);
    for (const u of USERS) console.log(`    ${u.role.padEnd(5)}  ${u.email}`);
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
