
import express, { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import slugify from "slugify";
import { uuidv7 } from "uuidv7";
import { db, withActor } from "../../db/client";
import {
  orders, orderItems, orderStatusHistory, auditLog, coupons, products, categories,
  productImages, users,
} from "../../db/schema";
import { allowMethods, getActor, assertCan, requireAdmin } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { assertTransition, type OrderStatus } from "../../orders/state-machine";
import { searchActivity } from "../../activity/activity-log";
import { toCsv, parseCsv, CSV_LIMITS, CsvRejected } from "../../exports/csv";
import { sanitiseProse } from "../../security/sanitise";
import { aiTokensSpent } from "../../observability/metrics";
import { logger } from "../../observability/logger";
import { ORDER_COLUMNS, hydrateOrders } from "../../orders/serialize";

const router = Router();
router.use(requireAuth, requireAdmin);

const rupees = (p: bigint | string | null) => (p === null ? 0 : Number(BigInt(p)) / 100);
const toPaisa = (rs: number) => BigInt(Math.round(rs * 100));
const like = (s: string) => `%${s.replace(/[%_\\]/g, "\\$&")}%`;

router.get("/analytics", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const d = await withActor(actor, async (tx) => {
      const [sales] = await tx.select({
        total: sql<string>`COALESCE(SUM(${orders.totalPaisa}) FILTER (WHERE ${orders.paymentStatus} = 'PAID'), 0)`,
        orderCount: sql<number>`count(*)::int`,
      }).from(orders);
      const [prod] = await tx.select({
        total: sql<number>`count(*)::int`,
        outOfStock: sql<number>`count(*) FILTER (WHERE ${products.stock} = 0)::int`,
      }).from(products);
      const [usr] = await tx.select({ total: sql<number>`count(*)::int` }).from(users);
      const byStatus = await tx.select({ status: orders.status, n: sql<number>`count(*)::int` })
        .from(orders).groupBy(orders.status);
      const recent = await tx.select({
        id: orders.id, orderNo: orders.orderNo, status: orders.status,
        totalPaisa: orders.totalPaisa, createdAt: orders.createdAt,
      }).from(orders).orderBy(desc(orders.createdAt)).limit(5);
      const topProducts = await tx.select({
        name: orderItems.productName,
        sold: sql<number>`SUM(${orderItems.quantity})::int`,
      }).from(orderItems).groupBy(orderItems.productName)
        .orderBy(desc(sql`SUM(${orderItems.quantity})`)).limit(5);
      return { sales, prod, usr, byStatus, recent, topProducts };
    });

    res.json({
      message: "Analytics fetched",
      totalSales: rupees(d.sales.total),
      totalOrders: d.sales.orderCount,
      totalProducts: d.prod.total,
      totalOutOfStockProducts: d.prod.outOfStock,
      totalUsers: d.usr.total,
      ordersByStatus: d.byStatus,
      topProducts: d.topProducts,
      recentOrders: d.recent.map((o) => ({
        _id: o.id, orderNo: o.orderNo, status: o.status,
        total: rupees(o.totalPaisa), createdAt: o.createdAt,
      })),
    });
  } catch (e) { next(e); }
});

router.get("/orders", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const q = z.object({
      status: z.enum(["PENDING_PAYMENT","PAID","PACKED","SHIPPED","DELIVERED","CANCELLED","REFUNDED"]).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      keyword: z.string().trim().max(64).optional(),
    }).strict().safeParse(req.query);
    if (!q.success) { res.status(400).json({ message: "Invalid query" }); return; }

    const limit = q.data.limit ?? 50, page = q.data.page ?? 1;
    const where: any[] = [];
    if (q.data.status) where.push(eq(orders.status, q.data.status));
    if (q.data.keyword) where.push(sql`${orders.orderNo} ILIKE ${like(q.data.keyword)}`);
    const filter = where.length ? and(...where) : undefined;

    const out = await withActor(actor, async (tx) => {
      const rows = await tx.select(ORDER_COLUMNS).from(orders).where(filter)
        .orderBy(desc(orders.createdAt)).limit(limit).offset((page - 1) * limit);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(orders).where(filter);
      return { orders: await hydrateOrders(rows, tx, { includeUserId: true }), total: n };
    });

    res.json({ message: "Orders fetched", orders: out.orders,
      pagination: { total: out.total, page, limit, totalPages: Math.max(1, Math.ceil(out.total / limit)) } });
  } catch (e) { next(e); }
});

router.put("/orders/:id/status", allowMethods("PUT"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const id = z.string().uuid().safeParse(req.params.id);
    const body = z.object({
      status: z.enum(["PENDING_PAYMENT","PAID","PACKED","SHIPPED","DELIVERED","CANCELLED","REFUNDED"]),
      note: z.string().trim().max(500).optional(),
    }).strict().safeParse(req.body);
    if (!id.success || !body.success) { res.status(400).json({ message: "Invalid request" }); return; }
    assertCan(actor, "order:transition", { kind: "order", ownerId: "" });

    const order = await withActor(actor, async (tx) => {
      const cur = await tx.execute(sql`SELECT status FROM orders WHERE id = ${id.data} FOR UPDATE`);
      const row = cur.rows[0] as { status: OrderStatus } | undefined;
      if (!row) { const e: any = new Error("Not found"); e.httpStatus = 404; throw e; }
      assertTransition(row.status, body.data.status);

      await tx.update(orders).set({ status: body.data.status, updatedAt: new Date() })
        .where(eq(orders.id, id.data));
      await tx.insert(orderStatusHistory).values({
        id: uuidv7(), orderId: id.data, status: body.data.status, note: body.data.note ?? null });
      await tx.insert(auditLog).values({
        id: uuidv7(), actorUserId: actor.id, action: "ORDER_STATUS_CHANGED",
        resourceType: "order", resourceId: id.data,
        metadata: { from: row.status, to: body.data.status } });
      const rows = await tx.select(ORDER_COLUMNS).from(orders).where(eq(orders.id, id.data));
      return (await hydrateOrders(rows, tx, { includeUserId: true }))[0];
    });

    res.json({ message: "Order status updated", order });
  } catch (e) { next(e); }
});

const PRODUCT_COLUMNS = {
  id: products.id, name: products.name, slug: products.slug, description: products.description,
  salePricePaisa: products.salePricePaisa, originalPricePaisa: products.originalPricePaisa,
  discountPercent: products.discountPercent, discountLabel: products.discountLabel,
  unit: products.unit, stock: products.stock, isActive: products.isActive,
  ratingAverage: products.ratingAverage, reviewCount: products.reviewCount,
  categoryId: products.categoryId, createdAt: products.createdAt,
} as const;

async function withImages(rows: any[]) {
  if (rows.length === 0) return [];
  const imgs = await db.select({ productId: productImages.productId, url: productImages.url })
    .from(productImages).where(inArray(productImages.productId, rows.map((r) => r.id)));
  const map = new Map<string, string[]>();
  for (const i of imgs) { const l = map.get(i.productId) ?? []; l.push(i.url); map.set(i.productId, l); }
  return rows.map((r) => ({
    _id: r.id, name: r.name, slug: r.slug, description: r.description ?? "",
    images: map.get(r.id) ?? [],
    originalPrice: rupees(r.originalPricePaisa), salePrice: rupees(r.salePricePaisa),
    discountPercent: r.discountPercent, discountLabel: r.discountLabel,
    unit: r.unit, stockCount: r.stock, isActive: r.isActive,
    ratingAverage: r.ratingAverage / 1000, reviewCount: r.reviewCount,
    categoryId: r.categoryId, createdAt: r.createdAt,
  }));
}

router.get("/products", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const q = z.object({
      keyword: z.string().trim().max(120).optional(),
      categoryId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).strict().safeParse(req.query);
    if (!q.success) { res.status(400).json({ message: "Invalid query" }); return; }

    const limit = q.data.limit ?? 50, page = q.data.page ?? 1;
    const where: any[] = [];
    if (q.data.categoryId) where.push(eq(products.categoryId, q.data.categoryId));
    if (q.data.keyword) where.push(sql`${products.name} ILIKE ${like(q.data.keyword)}`);
    const filter = where.length ? and(...where) : undefined;

    const rows = await withActor(actor, (tx) =>
      tx.select(PRODUCT_COLUMNS).from(products).where(filter)
        .orderBy(desc(products.createdAt)).limit(limit).offset((page - 1) * limit));
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(filter);

    res.json({ message: "Products fetched", products: await withImages(rows),
      pagination: { total: n, page, limit, totalPages: Math.max(1, Math.ceil(n / limit)) } });
  } catch (e) { next(e); }
});

const productBody = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  categoryId: z.string().uuid(),
  originalPrice: z.coerce.number().min(0).max(10_000_000),
  discountPercent: z.coerce.number().int().min(0).max(100).optional(),
  unit: z.string().trim().max(32).optional(),
  stockCount: z.coerce.number().int().min(0).max(1_000_000),
  images: z.array(z.string().url().max(2048)).max(10).optional(),
  isActive: z.coerce.boolean().optional(),
}).strict();

router.post("/products", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "create", { kind: "product" });
    const body = productBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid product" }); return; }
    const b = body.data;

    const discount = b.discountPercent ?? 0;
    const original = toPaisa(b.originalPrice);
    const sale = discount > 0 ? (original * BigInt(100 - discount)) / 100n : original;
    const id = uuidv7();

    await withActor(actor, async (tx) => {
      await tx.insert(products).values({
        id, userId: actor.id, categoryId: b.categoryId, name: b.name,
        slug: `${slugify(b.name, { lower: true, strict: true })}-${id.slice(0, 6)}`,
        description: b.description ? sanitiseProse(b.description) : null, // XSS-sanitised on write
        originalPricePaisa: original, salePricePaisa: sale,
        discountPercent: discount, discountLabel: discount > 0 ? `${discount}% OFF` : null,
        unit: b.unit ?? "pc", stock: b.stockCount, isActive: b.isActive ?? true,
      });
      for (const [i, url] of (b.images ?? []).entries())
        await tx.insert(productImages).values({ id: uuidv7(), productId: id, url, position: i });
    });

    const rows = await db.select(PRODUCT_COLUMNS).from(products).where(eq(products.id, id));
    res.status(201).json({ message: "Product created", product: (await withImages(rows))[0] });
  } catch (e) { next(e); }
});

router.put("/products/:id", allowMethods("PUT"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "update", { kind: "product" });
    const id = z.string().uuid().safeParse(req.params.id);
    const body = productBody.partial().strict().safeParse(req.body);
    if (!id.success || !body.success) { res.status(400).json({ message: "Invalid request" }); return; }
    const b = body.data;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.name !== undefined) patch.name = b.name;
    if (b.description !== undefined) patch.description = sanitiseProse(b.description);
    if (b.categoryId !== undefined) patch.categoryId = b.categoryId;
    if (b.unit !== undefined) patch.unit = b.unit;
    if (b.stockCount !== undefined) patch.stock = b.stockCount;
    if (b.isActive !== undefined) patch.isActive = b.isActive;
    if (b.originalPrice !== undefined) {
      const d = b.discountPercent ?? 0;
      const original = toPaisa(b.originalPrice);
      patch.originalPricePaisa = original;
      patch.salePricePaisa = d > 0 ? (original * BigInt(100 - d)) / 100n : original;
      patch.discountPercent = d;
      patch.discountLabel = d > 0 ? `${d}% OFF` : null;
    }

    const r = await withActor(actor, (tx) =>
      tx.update(products).set(patch).where(eq(products.id, id.data)).returning({ id: products.id }));
    if (r.length === 0) { res.status(404).json({ message: "Not found" }); return; }
    const rows = await db.select(PRODUCT_COLUMNS).from(products).where(eq(products.id, id.data));
    res.json({ message: "Product updated", product: (await withImages(rows))[0] });
  } catch (e) { next(e); }
});

router.delete("/products/:id", allowMethods("DELETE"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "delete", { kind: "product" });
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.status(404).json({ message: "Not found" }); return; }
    const r = await withActor(actor, (tx) =>
      tx.update(products).set({ isActive: false, updatedAt: new Date() })
        .where(eq(products.id, id.data)).returning({ id: products.id }));
    if (r.length === 0) { res.status(404).json({ message: "Not found" }); return; }
    res.json({ message: "Product deactivated" });
  } catch (e) { next(e); }
});

const categoryBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  imageUrl: z.string().url().max(2048).optional(),
  isActive: z.coerce.boolean().optional(),
}).strict();

router.get("/categories", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const rows = await withActor(actor, (tx) =>
      tx.select({
        id: categories.id, name: categories.name, slug: categories.slug,
        imageUrl: categories.imageUrl, description: categories.description,
        isActive: categories.isActive, createdAt: categories.createdAt,
      }).from(categories).orderBy(desc(categories.createdAt)).limit(200));
    const counts = await db.select({ categoryId: products.categoryId, n: sql<number>`count(*)::int` })
      .from(products).groupBy(products.categoryId);
    const cmap = new Map(counts.map((c) => [c.categoryId, c.n]));
    res.json({
      message: "Categories fetched",
      categories: rows.map((c) => ({
        _id: c.id, name: c.name, slug: c.slug, imageUrl: c.imageUrl ?? "",
        description: c.description ?? "", isActive: c.isActive,
        productCount: cmap.get(c.id) ?? 0, createdAt: c.createdAt,
      })),
    });
  } catch (e) { next(e); }
});

router.post("/categories", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "create", { kind: "category" });
    const b = categoryBody.safeParse(req.body);
    if (!b.success) { res.status(400).json({ message: "Invalid category" }); return; }
    const id = uuidv7();
    await withActor(actor, (tx) => tx.insert(categories).values({
      id, name: b.data.name, slug: slugify(b.data.name, { lower: true, strict: true }),
      description: b.data.description ?? null, imageUrl: b.data.imageUrl ?? null,
      isActive: b.data.isActive ?? true,
    }));
    res.status(201).json({ message: "Category created", category: { _id: id, ...b.data } });
  } catch (e) { next(e); }
});

router.put("/categories/:id", allowMethods("PUT"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "update", { kind: "category" });
    const id = z.string().uuid().safeParse(req.params.id);
    const b = categoryBody.partial().strict().safeParse(req.body);
    if (!id.success || !b.success) { res.status(400).json({ message: "Invalid request" }); return; }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.data.name !== undefined) {
      patch.name = b.data.name;
      patch.slug = slugify(b.data.name, { lower: true, strict: true });
    }
    if (b.data.description !== undefined) patch.description = b.data.description;
    if (b.data.imageUrl !== undefined) patch.imageUrl = b.data.imageUrl;
    if (b.data.isActive !== undefined) patch.isActive = b.data.isActive;
    const r = await withActor(actor, (tx) =>
      tx.update(categories).set(patch).where(eq(categories.id, id.data)).returning({ id: categories.id }));
    if (r.length === 0) { res.status(404).json({ message: "Not found" }); return; }
    res.json({ message: "Category updated" });
  } catch (e) { next(e); }
});

router.delete("/categories/:id", allowMethods("DELETE"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "delete", { kind: "category" });
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.status(404).json({ message: "Not found" }); return; }
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(products)
      .where(eq(products.categoryId, id.data));
    if (n > 0) { res.status(409).json({ message: `Category still has ${n} product(s)` }); return; }
    const r = await withActor(actor, (tx) =>
      tx.delete(categories).where(eq(categories.id, id.data)).returning({ id: categories.id }));
    if (r.length === 0) { res.status(404).json({ message: "Not found" }); return; }
    res.json({ message: "Category deleted" });
  } catch (e) { next(e); }
});

router.get("/users", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const q = z.object({
      keyword: z.string().trim().max(120).optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).strict().safeParse(req.query);
    if (!q.success) { res.status(400).json({ message: "Invalid query" }); return; }
    const limit = q.data.limit ?? 50, page = q.data.page ?? 1;
    const filter = q.data.keyword
      ? sql`(${users.name} ILIKE ${like(q.data.keyword)} OR ${users.email} ILIKE ${like(q.data.keyword)})`
      : undefined;

    const { rows, oc } = await withActor(actor, async (tx) => ({
      rows: await tx.select({
        id: users.id, name: users.name, email: users.email, role: users.role,
        emailVerified: users.emailVerified, banned: users.banned, createdAt: users.createdAt,
      }).from(users).where(filter).orderBy(desc(users.createdAt))
        .limit(limit).offset((page - 1) * limit),
      oc: await tx.select({ userId: orders.userId, n: sql<number>`count(*)::int` })
        .from(orders).groupBy(orders.userId),
    }));
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users).where(filter);
    const omap = new Map(oc.map((o) => [o.userId, o.n]));

    res.json({
      message: "Users fetched",
      users: rows.map((u) => ({
        _id: u.id, name: u.name, email: u.email, role: u.role,
        emailVerified: u.emailVerified, banned: u.banned,
        orderCount: omap.get(u.id) ?? 0, createdAt: u.createdAt,
      })),
      pagination: { total: n, page, limit, totalPages: Math.max(1, Math.ceil(n / limit)) },
    });
  } catch (e) { next(e); }
});

router.put("/users/:id/ban", allowMethods("PUT"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const id = z.string().uuid().safeParse(req.params.id);
    const b = z.object({ banned: z.boolean(), reason: z.string().trim().max(200).optional() })
      .strict().safeParse(req.body);
    if (!id.success || !b.success) { res.status(400).json({ message: "Invalid request" }); return; }
    if (id.data === actor.id) { res.status(409).json({ message: "You cannot ban yourself" }); return; }

    const r = await withActor(actor, async (tx) => {
      const upd = await tx.update(users)
        .set({ banned: b.data.banned, banReason: b.data.reason ?? null, updatedAt: new Date() })
        .where(eq(users.id, id.data)).returning({ id: users.id });
      if (upd.length) {
        if (b.data.banned) await tx.execute(sql`DELETE FROM sessions WHERE user_id = ${id.data}`);
        await tx.insert(auditLog).values({
          id: uuidv7(), actorUserId: actor.id, action: "ADMIN_ACTION",
          resourceType: "user", resourceId: id.data, metadata: { banned: b.data.banned } });
      }
      return upd;
    });
    if (r.length === 0) { res.status(404).json({ message: "Not found" }); return; }
    res.json({ message: b.data.banned ? "User banned" : "User unbanned" });
  } catch (e) { next(e); }
});

const couponSchema = z.object({
  code: z.string().trim().min(1).max(64),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().int().positive(),
  minSpendPaisa: z.coerce.number().int().min(0).optional(),
  maxRedemptions: z.coerce.number().int().positive().optional(),
  perUserLimit: z.coerce.number().int().positive().optional(),
  stackable: z.boolean().optional(),
}).strict().refine((c) => c.type !== "PERCENT" || (c.value >= 1 && c.value <= 100),
  { message: "percent must be 1..100" });

router.get("/coupons", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "list", { kind: "coupon" });
    const rows = await withActor(actor, (tx) =>
      tx.select({
        id: coupons.id, code: coupons.code, type: coupons.type, value: coupons.value,
        maxRedemptions: coupons.maxRedemptions, timesRedeemed: coupons.timesRedeemed,
        active: coupons.active,
      }).from(coupons).orderBy(desc(coupons.createdAt)).limit(200));
    res.json({ message: "Coupons fetched",
      coupons: rows.map((r) => ({ ...r, _id: r.id, value: String(r.value) })) });
  } catch (e) { next(e); }
});

router.post("/coupons", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "create", { kind: "coupon" });
    const b = couponSchema.safeParse(req.body);
    if (!b.success) { res.status(400).json({ message: "Invalid coupon" }); return; }
    const id = uuidv7();
    await withActor(actor, (tx) => tx.insert(coupons).values({
      id, code: b.data.code, type: b.data.type, value: BigInt(b.data.value),
      minSpendPaisa: BigInt(b.data.minSpendPaisa ?? 0),
      maxRedemptions: b.data.maxRedemptions ?? null,
      perUserLimit: b.data.perUserLimit ?? 1, stackable: b.data.stackable ?? false,
    }));
    res.status(201).json({ message: "Coupon created", _id: id });
  } catch (e) { next(e); }
});

router.post("/activity/search", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req)!, "list", { kind: "auditLog" });
    res.json({ items: await searchActivity(req.body) });
  } catch (e) { next(e); }
});

router.get("/audit", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "list", { kind: "auditLog" });
    const rows = await withActor(actor, (tx) =>
      tx.select({
        id: auditLog.id, action: auditLog.action, actorUserId: auditLog.actorUserId,
        resourceType: auditLog.resourceType, resourceId: auditLog.resourceId,
        createdAt: auditLog.createdAt,
      }).from(auditLog).orderBy(desc(auditLog.createdAt)).limit(200));
    res.json({ message: "Audit fetched", items: rows });
  } catch (e) { next(e); }
});

router.get("/products.csv", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "list", { kind: "product" });
    const rows = await withActor(actor, (tx) =>
      tx.select({ id: products.id, name: products.name, slug: products.slug,
        price: products.salePricePaisa, stock: products.stock }).from(products).limit(5000));
    const csv = toCsv(["id", "name", "slug", "sale_price_paisa", "stock"],
      rows.map((r) => [r.id, r.name, r.slug, String(r.price), r.stock]));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=products.csv");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(csv);
  } catch (e) { next(e); }
});

router.post("/products/import.csv", allowMethods("POST"),
  express.text({ type: "text/csv", limit: CSV_LIMITS.maxBytes }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      assertCan(getActor(req)!, "create", { kind: "product" });
      const rows = parseCsv(typeof req.body === "string" ? req.body : "");
      const [header, ...data] = rows;
      if (!header) { res.status(400).json({ message: "Empty CSV" }); return; }
      const rowSchema = z.tuple([
        z.string().trim().min(1).max(200),
        z.coerce.number().int().min(0),
        z.coerce.number().int().min(0),
      ]);
      const rejected: number[] = [];
      let accepted = 0;
      data.forEach((r, i) => { rowSchema.safeParse(r).success ? accepted++ : rejected.push(i + 2); });
      res.json({ message: "CSV parsed", accepted, rejectedRows: rejected, total: data.length });
    } catch (e) {
      if (e instanceof CsvRejected) { res.status(400).json({ message: e.reason }); return; }
      next(e);
    }
  });

const aiGenerateSchema = z.object({
  action: z.enum(["rephrase-title", "generate-desc"]),
  title: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(32).optional(),
  description: z.string().trim().max(4000).optional(),
}).strict();

router.post("/ai/generate", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "update", { kind: "product" });
    const parsed = aiGenerateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ message: "Invalid request" }); return; }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ message: "AI is not configured. Set OPENAI_API_KEY to enable it." });
      return;
    }

    const { action, title, unit, description } = parsed.data;
    const system =
      "You write concise, factual copy for a Nepali online grocery store. " +
      "Prices are in Nepali Rupees. Never invent claims about health, origin, or certification. " +
      "Reply with the requested text only, as plain text, with no markdown and no preamble.";
    const prompt = action === "rephrase-title"
      ? `Rewrite this grocery product title to be clear and appealing, at most 60 characters:\n\n${title}`
      : `Write a short product description (2 to 3 sentences) for this grocery item.\n` +
        `Name: ${title}\nUnit: ${unit ?? "unspecified"}\n` +
        `Existing notes: ${description || "none"}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL_ID ?? "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      const code = /"code"\s*:\s*"([^"]+)"/.exec(detail)?.[1];
      logger.error({ upstreamStatus: r.status, code }, "AI provider call failed");
      const isAccount = r.status === 401 || r.status === 403 ||
        (code != null && /billing|quota|inactive/i.test(code));
      res.status(502).json({
        message: isAccount
          ? "AI is unavailable: the provider account is not active. Check billing and quota."
          : "The AI service did not respond.",
      });
      return;
    }

    const body = (await r.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    const model = process.env.AI_MODEL_ID ?? "gpt-4o-mini";
    aiTokensSpent.inc({ model }, body.usage?.total_tokens ?? 0);
    const result = sanitiseProse(body.choices?.[0]?.message?.content ?? "").slice(0, 1200);
    res.json({ message: "Generated", result });
  } catch (e) { next(e); }
});

export default router;
