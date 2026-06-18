import "dotenv/config";
import { Client } from "pg";
import { uuidv7 } from "uuidv7";
import slugify from "slugify";

const CATEGORIES = [
  { name: "Beverages", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265027/Beverages_lcunrb.png", desc: "Drinks, juices, and everyday refreshments." },
  { name: "Snacks", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265027/Snacks_wxordv.png", desc: "Chips, biscuits, and quick bites." },
  { name: "Bakery", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265027/Bakery_xwbrje.png", desc: "Fresh bread, pastries, and baked goods." },
  { name: "Baby Care", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265026/Baby_Care_bxxwu0.png", desc: "Essentials for infants and toddlers." },
  { name: "Frozen Foods", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265027/Frozen_Foods_wknnin.png", desc: "Frozen meals and freezer staples." },
  { name: "Fruits & Vegetables", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265026/Fruits_Vegetables_lnmslm.png", desc: "Fresh produce for everyday cooking." },
  { name: "Meat & Seafood", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265026/Meat_Seafood_nhtxen.png", desc: "Fresh meat, fish, and seafood options." },
  { name: "Pantry Staples", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265027/Pantry_Staples_ppwolo.png", desc: "Rice, flour, oil, and pantry basics." },
  { name: "Personal Care", img: "https://res.cloudinary.com/dp9vvlndo/image/upload/v1781265026/Personal_Care_osossq.png", desc: "Daily hygiene and personal grooming items." },
];

type SeedProduct = {
  name: string; category: string; desc: string; price: number;
  discount?: number; unit: string; stock: number; img: string; active?: boolean;
};

const PRODUCTS: SeedProduct[] = [
  { name: "Fresh Apples", category: "Fruits & Vegetables", desc: "Crisp and juicy red apples, hand-picked.", price: 24900, unit: "kg", stock: 100, img: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=600" },
  { name: "Organic Bananas", category: "Fruits & Vegetables", desc: "Sweet organic bananas, naturally ripened.", price: 8900, discount: 10, unit: "dozen", stock: 75, img: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=600" },
  { name: "Baby Spinach", category: "Fruits & Vegetables", desc: "Tender leaves, washed and ready to cook.", price: 6500, unit: "bunch", stock: 60, img: "https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=600" },
  { name: "Whole Wheat Bread", category: "Bakery", desc: "Freshly baked whole wheat loaf, no preservatives.", price: 9900, unit: "pc", stock: 50, img: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600" },
  { name: "Butter Croissant", category: "Bakery", desc: "Flaky, all-butter, baked each morning.", price: 12000, discount: 15, unit: "pack of 4", stock: 40, img: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600" },
  { name: "Orange Juice", category: "Beverages", desc: "Cold-pressed, no added sugar.", price: 19900, discount: 15, unit: "1 L", stock: 30, img: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=600" },
  { name: "Green Tea", category: "Beverages", desc: "Whole-leaf green tea, 100 bags.", price: 34900, unit: "box", stock: 45, img: "https://images.unsplash.com/photo-1627435601361-ec25f5b1d0e5?w=600" },
  { name: "Salted Potato Chips", category: "Snacks", desc: "Kettle-cooked, lightly salted.", price: 5900, unit: "pack", stock: 200, img: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=600" },
  { name: "Dark Chocolate Cookies", category: "Snacks", desc: "70% cocoa, crunchy centre.", price: 14900, discount: 5, unit: "pack", stock: 80, img: "https://images.unsplash.com/photo-1499636136210-6f4ee915583e?w=600" },
  { name: "Basmati Rice", category: "Pantry Staples", desc: "Aged long-grain basmati.", price: 89900, unit: "5 kg", stock: 35, img: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600" },
  { name: "Extra Virgin Olive Oil", category: "Pantry Staples", desc: "Cold-pressed, first harvest.", price: 74900, discount: 20, unit: "1 L", stock: 25, img: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600" },
  { name: "Atlantic Salmon Fillet", category: "Meat & Seafood", desc: "Skin-on, sushi grade, flash frozen.", price: 129900, unit: "500 g", stock: 20, img: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=600" },
  { name: "Free-Range Chicken Breast", category: "Meat & Seafood", desc: "Boneless, antibiotic free.", price: 54900, discount: 10, unit: "kg", stock: 40, img: "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=600" },
  { name: "Mixed Berry Medley", category: "Frozen Foods", desc: "Strawberry, blueberry, raspberry.", price: 39900, unit: "500 g", stock: 55, img: "https://images.unsplash.com/photo-1596591606975-97ee5cef3a1e?w=600" },
  { name: "Aloe Vera Body Wash", category: "Personal Care", desc: "Sulphate-free, pH balanced.", price: 29900, discount: 25, unit: "500 ml", stock: 65, img: "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=600" },
  { name: "Baby Wipes", category: "Baby Care", desc: "Fragrance-free, 99% water.", price: 19900, unit: "pack of 72", stock: 90, img: "https://images.unsplash.com/photo-1584305574647-0cc949a2bb9f?w=600" },
  { name: "Seasonal Mango Crate", category: "Fruits & Vegetables", desc: "Out of season — hidden from the catalogue.", price: 99900, unit: "crate", stock: 0, img: "https://images.unsplash.com/photo-1553279768-865429fa0078?w=600", active: false },
];

function salePaisa(price: number, discount = 0): number {
  if (discount <= 0) return price;
  return Math.round(price * (100 - discount) / 100);
}

async function main() {
  const url = process.env.MIGRATOR_DATABASE_URL;
  if (!url) throw new Error("MIGRATOR_DATABASE_URL is not set — run scripts/setup.sh first");
  const db = new Client({ connectionString: url });
  await db.connect();

  try {
    await db.query("BEGIN");

    let owner = (await db.query(`SELECT id FROM users WHERE role='ADMIN' ORDER BY created_at LIMIT 1`)).rows[0]?.id;
    if (!owner) {
      owner = uuidv7();
      await db.query(
        `INSERT INTO users (id,name,email,role,email_verified) VALUES ($1,'Seed Owner','seed-owner@lab.test','ADMIN',true)`,
        [owner]
      );
      console.log("  created seed owner (no admin existed)");
    }

    await db.query(`DELETE FROM reviews`);
    await db.query(`DELETE FROM order_items`);
    await db.query(`DELETE FROM order_status_history`);
    await db.query(`DELETE FROM orders`);
    await db.query(`DELETE FROM cart_items`);
    await db.query(`DELETE FROM product_images`);
    await db.query(`DELETE FROM products`);
    await db.query(`DELETE FROM categories`);

    const catIds = new Map<string, string>();
    for (const c of CATEGORIES) {
      const id = uuidv7();
      catIds.set(c.name, id);
      await db.query(
        `INSERT INTO categories (id,name,slug,image_url,description,is_active) VALUES ($1,$2,$3,$4,$5,true)`,
        [id, c.name, slugify(c.name, { lower: true, strict: true }), c.img, c.desc]
      );
    }
    console.log(`  ${CATEGORIES.length} categories`);

    let n = 0;
    for (const p of PRODUCTS) {
      const categoryId = catIds.get(p.category);
      if (!categoryId) throw new Error(`unknown category: ${p.category}`);
      const id = uuidv7();
      const discount = p.discount ?? 0;
      await db.query(
        `INSERT INTO products
           (id,user_id,category_id,name,slug,description,original_price_paisa,sale_price_paisa,
            discount_percent,discount_label,unit,stock,per_order_limit,is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,10,$13)`,
        [
          id, owner, categoryId, p.name, slugify(p.name, { lower: true, strict: true }), p.desc,
          BigInt(p.price), BigInt(salePaisa(p.price, discount)),
          discount, discount > 0 ? `${discount}% OFF` : null,
          p.unit, p.stock, p.active !== false,
        ]
      );
      await db.query(
        `INSERT INTO product_images (id,product_id,url,position) VALUES ($1,$2,$3,0)`,
        [uuidv7(), id, p.img]
      );
      n++;
    }
    console.log(`  ${n} products (+1 image each)`);

    const scarce = uuidv7();
    await db.query(
      `INSERT INTO products (id,user_id,category_id,name,slug,description,original_price_paisa,
         sale_price_paisa,discount_percent,unit,stock,per_order_limit,is_active)
       VALUES ($1,$2,$3,'Limited Edition Hamper','limited-edition-hamper',
               'Exactly one in stock — used by the oversell race demo.',500000,500000,0,'box',1,10,true)`,
      [scarce, owner, catIds.get("Pantry Staples")]
    );
    await db.query(
      `INSERT INTO coupons (id,code,type,value,min_spend_paisa,max_redemptions,per_user_limit,active)
       VALUES ($1,'WELCOME10','PERCENT',10,0,NULL,1,true),
              ($2,'SINGLEUSE','FIXED',5000,0,1,1,true)
       ON CONFLICT (code) DO NOTHING`,
      [uuidv7(), uuidv7()]
    );
    console.log("  1 single-stock product + 2 coupons (pentest fixtures)");

    await db.query("COMMIT");

    const totals = await db.query(
      `SELECT (SELECT count(*) FROM categories) c, (SELECT count(*) FROM products) p,
              (SELECT count(*) FROM products WHERE is_active) pa`
    );
    const t = totals.rows[0];
    console.log(`\nSeeded: ${t.c} categories, ${t.p} products (${t.pa} active).`);
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
