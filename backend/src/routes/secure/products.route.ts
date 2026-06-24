
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, eq, gt, gte, lte, ilike, sql, desc, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { products, categories, productImages, reviews, users } from "../../db/schema";
import { resolveOrderBy, resolveOrderByNaiveForDemo } from "../../catalog/product-query";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { DEMO } from "../../security/demo-flags";

const router = Router();

const rupees = (paisa: bigint | string | null): number =>
  paisa === null ? 0 : Number(BigInt(paisa)) / 100;

const SORT_MAP: Record<string, "price" | "rating" | "name" | "created"> = {
  "best-match": "created",
  newest: "created",
  "price-low": "price",
  "price-high": "price",
  rating: "rating",
  name: "name",
};
const SORT_DIR: Record<string, "asc" | "desc"> = { "price-low": "asc", "price-high": "desc" };

const listQuerySchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    keyword: z.string().trim().max(120).optional(),
    minPrice: z.coerce.number().min(0).optional(),
    maxPrice: z.coerce.number().min(0).optional(),
    hasDiscount: z.coerce.boolean().optional(),
    inStock: z.coerce.boolean().optional(),
    sort: z.enum(["best-match", "newest", "price-low", "price-high", "rating", "name"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(60).optional(),
    skip: z.coerce.number().int().min(0).optional(),
  })
  .strict();

type Row = {
  id: string; name: string; slug: string; description: string | null;
  salePricePaisa: bigint | string; originalPricePaisa: bigint | string;
  discountPercent: number; discountLabel: string | null; unit: string;
  stock: number; ratingAverage: number; reviewCount: number;
};

const toClient = (r: Row, images: string[]) => ({
  _id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description ?? "",
  images,
  originalPrice: rupees(r.originalPricePaisa),
  salePrice: rupees(r.salePricePaisa),
  discountPercent: r.discountPercent,
  discountLabel: r.discountLabel,
  unit: r.unit,
  stockCount: r.stock,
  ratingAverage: r.ratingAverage / 1000,
  reviewCount: r.reviewCount,
});

const PRODUCT_COLUMNS = {
  id: products.id, name: products.name, slug: products.slug, description: products.description,
  salePricePaisa: products.salePricePaisa, originalPricePaisa: products.originalPricePaisa,
  discountPercent: products.discountPercent, discountLabel: products.discountLabel,
  unit: products.unit, stock: products.stock,
  ratingAverage: products.ratingAverage, reviewCount: products.reviewCount,
} as const;

async function imagesFor(ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(inArray(productImages.productId, ids));
  for (const r of rows) {
    const list = map.get(r.productId) ?? [];
    list.push(r.url);
    map.set(r.productId, list);
  }
  return map;
}

router.get("/", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req), "list", { kind: "product" });

    if (DEMO.DISABLE_SQL_ALLOWLIST) {
      const clause = resolveOrderByNaiveForDemo(
        typeof req.query.sort === "string" ? req.query.sort : undefined,
        typeof req.query.dir === "string" ? req.query.dir : undefined
      );
      const naive = await db.execute(
        sql.raw(`SELECT id, name, slug, sale_price_paisa FROM products WHERE is_active = true ${clause} LIMIT 20`)
      );
      res.json({ message: "Products fetched", products: naive.rows, pagination: { total: naive.rows.length, page: 1, limit: 20, totalPages: 1, hasMore: false } });
      return;
    }

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ message: "Invalid query" }); return; }
    const q = parsed.data;

    const where = [eq(products.isActive, true)];
    if (q.categoryId) where.push(eq(products.categoryId, q.categoryId));
    if (q.minPrice !== undefined) where.push(gte(products.salePricePaisa, BigInt(Math.round(q.minPrice * 100))));
    if (q.maxPrice !== undefined) where.push(lte(products.salePricePaisa, BigInt(Math.round(q.maxPrice * 100))));
    if (q.hasDiscount) where.push(gt(products.discountPercent, 0));
    if (q.inStock) where.push(gt(products.stock, 0));
    if (q.keyword) where.push(ilike(products.name, `%${q.keyword.replace(/[%_\\]/g, "\\$&")}%`));

    const limit = q.limit ?? 20;
    const page = q.page ?? 1;
    const offset = q.skip ?? (page - 1) * limit;

    const sortKey = q.sort ? SORT_MAP[q.sort] : undefined;
    const orderBy = resolveOrderBy(sortKey, q.sort ? SORT_DIR[q.sort] : undefined);

    const rows = await db.select(PRODUCT_COLUMNS).from(products)
      .where(and(...where)).orderBy(orderBy).limit(limit).offset(offset);

    const countRes = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(...where));
    const total = countRes[0]?.n ?? 0;
    const imgs = await imagesFor(rows.map((r) => r.id));

    res.json({
      message: "Products fetched",
      products: rows.map((r) => toClient(r as Row, imgs.get(r.id) ?? [])),
      pagination: {
        total, page, limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: offset + rows.length < total,
      },
    });
  } catch (e) { next(e); }
});

router.get("/deals", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req), "list", { kind: "product" });
    const limit = z.coerce.number().int().min(1).max(24).safeParse(req.query.limit);
    const n = limit.success ? limit.data : 6;

    const rows = await db.select(PRODUCT_COLUMNS).from(products)
      .where(and(eq(products.isActive, true), gt(products.discountPercent, 0)))
      .orderBy(desc(products.discountPercent))
      .limit(n);

    const imgs = await imagesFor(rows.map((r) => r.id));
    res.json({ message: "Deals fetched", products: rows.map((r) => toClient(r as Row, imgs.get(r.id) ?? [])) });
  } catch (e) { next(e); }
});

router.get("/:slug/reviews", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req), "list", { kind: "review", ownerId: "" });
    const slug = z.string().min(1).max(200).safeParse(req.params.slug);
    if (!slug.success) { res.status(404).json({ message: "Not found" }); return; }

    const prod = await db.select({ id: products.id }).from(products)
      .where(eq(products.slug, slug.data)).limit(1);
    if (prod.length === 0) { res.status(404).json({ message: "Not found" }); return; }

    const page = z.coerce.number().int().min(1).catch(1).parse(req.query.page ?? 1);
    const limit = z.coerce.number().int().min(1).max(50).catch(10).parse(req.query.limit ?? 10);

    const rows = await db
      .select({
        id: reviews.id, rating: reviews.rating, comment: reviews.comment,
        createdAt: reviews.createdAt, authorId: users.id, authorName: users.name,
      })
      .from(reviews).innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.productId, prod[0].id))
      .orderBy(desc(reviews.createdAt))
      .limit(limit).offset((page - 1) * limit);

    const breakdown = await db
      .select({ rating: reviews.rating, count: sql<number>`count(*)::int` })
      .from(reviews).where(eq(reviews.productId, prod[0].id)).groupBy(reviews.rating);
    const total = breakdown.reduce((a, b) => a + b.count, 0);

    res.json({
      message: "Reviews fetched",
      reviews: rows.map((r) => ({
        _id: r.id,
        userId: { _id: r.authorId, name: r.authorName },
        rating: r.rating,
        comment: r.comment ?? "",
        createdAt: r.createdAt,
      })),
      ratingBreakdown: breakdown.map((b) => ({ rating: b.rating, count: b.count })),
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (e) { next(e); }
});

router.get("/:slug", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req), "read", { kind: "product" });
    const slug = z.string().min(1).max(200).safeParse(req.params.slug);
    if (!slug.success) { res.status(404).json({ message: "Not found" }); return; }

    const rows = await db
      .select({
        ...PRODUCT_COLUMNS,
        categoryId: categories.id, categoryName: categories.name, categorySlug: categories.slug,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(and(eq(products.slug, slug.data), eq(products.isActive, true)))
      .limit(1);

    if (rows.length === 0) { res.status(404).json({ message: "Not found" }); return; }
    const r = rows[0];

    const related = await db.select(PRODUCT_COLUMNS).from(products)
      .where(and(eq(products.categoryId, r.categoryId), eq(products.isActive, true)))
      .limit(5);
    const relatedFiltered = related.filter((x) => x.id !== r.id).slice(0, 4);

    const imgs = await imagesFor([r.id, ...relatedFiltered.map((x) => x.id)]);

    res.json({
      message: "Product fetched",
      product: {
        ...toClient(r as Row, imgs.get(r.id) ?? []),
        categoryId: { _id: r.categoryId, name: r.categoryName, slug: r.categorySlug },
      },
      relatedProducts: relatedFiltered.map((x) => toClient(x as Row, imgs.get(x.id) ?? [])),
    });
  } catch (e) { next(e); }
});

export default router;
