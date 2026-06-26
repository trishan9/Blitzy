
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sql, eq, desc } from "drizzle-orm";
import { db, withActor, pgErrorCode } from "../../db/client";
import { reviews, users } from "../../db/schema";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { sanitiseProse } from "../../security/sanitise";
import { uuidv7 } from "uuidv7";

const router = Router();

const createReviewSchema = z
  .object({
    orderItemId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();

router.get("/reviewable", allowMethods("GET"), requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const rows: any = await withActor(actor, (tx) =>
      tx.execute(sql`
        SELECT o.id AS order_id, o.order_no, o.created_at,
               oi.id AS order_item_id, oi.product_name, oi.image_url, oi.is_reviewed
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.user_id = ${actor.id} AND o.status = 'DELIVERED'
        ORDER BY o.created_at DESC
      `)
    );

    const byOrder = new Map<string, any>();
    for (const r of rows.rows as any[]) {
      let o = byOrder.get(r.order_id);
      if (!o) {
        o = { _id: r.order_id, orderNo: r.order_no, createdAt: r.created_at, items: [] };
        byOrder.set(r.order_id, o);
      }
      o.items.push({
        _id: r.order_item_id,      // the id the POST expects as orderItemId
        name: r.product_name,
        image: r.image_url ?? "",
        isReviewed: r.is_reviewed,
      });
    }
    res.json({ message: "Reviewable items fetched", orders: [...byOrder.values()] });
  } catch (e) { next(e); }
});

router.get("/", allowMethods("GET"), requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const rows: any = await withActor(actor, (tx) =>
      tx.execute(sql`
        SELECT r.id, r.rating, r.comment, r.created_at,
               p.id AS product_id, p.name AS product_name, p.slug,
               (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image_url
        FROM reviews r JOIN products p ON p.id = r.product_id
        WHERE r.user_id = ${actor.id}
        ORDER BY r.created_at DESC
        LIMIT 100
      `)
    );
    res.json({
      message: "Reviews fetched",
      reviews: (rows.rows as any[]).map((r) => ({
        _id: r.id, rating: r.rating, comment: r.comment ?? "", createdAt: r.created_at,
        productId: {
          _id: r.product_id, name: r.product_name, slug: r.slug,
          images: r.image_url ? [r.image_url] : [],
        },
      })),
    });
  } catch (e) { next(e); }
});

router.get("/product/:productId", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertCan(getActor(req), "list", { kind: "review", ownerId: "" });
    const pid = z.string().uuid().safeParse(req.params.productId);
    if (!pid.success) { res.status(404).json({ error: "not found" }); return; }

    const rows = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        createdAt: reviews.createdAt,
        authorName: users.name, // explicit: name only, never users.email
      })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.userId))
      .where(eq(reviews.productId, pid.data))
      .orderBy(desc(reviews.createdAt))
      .limit(50);

    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/", allowMethods("POST"), requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const parsed = createReviewSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid request body" }); return; }
    assertCan(actor, "review:create", { kind: "review", ownerId: actor.id });

    const { orderItemId, rating, comment } = parsed.data;

    await withActor(actor, async (tx) => {
      const eligible = await tx.execute(sql`
        SELECT oi.id AS order_item_id, oi.product_id, o.id AS order_id
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE oi.id = ${orderItemId}
          AND o.user_id = ${actor.id}
          AND o.status = 'DELIVERED'
        LIMIT 1
      `);
      const row = eligible.rows[0] as
        | { order_item_id: string; product_id: string; order_id: string }
        | undefined;
      if (!row) {
        const e: any = new Error("not found"); e.httpStatus = 404; throw e;
      }

      try {
        await tx.execute(sql`
          INSERT INTO reviews (id, user_id, order_id, order_item_id, product_id, rating, comment)
          VALUES (${uuidv7()}, ${actor.id}, ${row.order_id}, ${row.order_item_id},
                  ${row.product_id}, ${rating}, ${comment ? sanitiseProse(comment) : null})
        `);
      } catch (err) {
        if (pgErrorCode(err) === "23505") {
          const e: any = new Error("already reviewed"); e.httpStatus = 409; throw e;
        }
        throw err;
      }

      await tx.execute(sql`UPDATE order_items SET is_reviewed = true WHERE id = ${row.order_item_id}`);
      await tx.execute(sql`
        INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id)
        VALUES (${uuidv7()}, ${actor.id}, 'ORDER_STATUS_CHANGED', 'review', ${row.order_item_id})
      `);
    });

    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
