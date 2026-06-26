import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, withActor } from "../../db/client";
import { wishlists, wishlistItems, products } from "../../db/schema";
import { allowMethods, getActor, assertCan, can } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { uuidv7 } from "uuidv7";

const router = Router();

async function ownWishlistId(actorId: string): Promise<string> {
  return withActor({ id: actorId, role: "USER" }, async (tx) => {
    const found = await tx.select({ id: wishlists.id }).from(wishlists).where(eq(wishlists.userId, actorId)).limit(1);
    if (found.length) return found[0].id;
    const id = uuidv7();
    await tx.insert(wishlists).values({ id, userId: actorId });
    return id;
  });
}

router.get("/", allowMethods("GET"), requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "read", { kind: "wishlist", ownerId: actor.id });
    const wid = await ownWishlistId(actor.id);
    const items = await withActor(actor, (tx) =>
      tx.select({ productId: wishlistItems.productId, name: products.name, slug: products.slug })
        .from(wishlistItems).innerJoin(products, eq(products.id, wishlistItems.productId))
        .where(eq(wishlistItems.wishlistId, wid)).limit(200)
    );
    res.json({ items });
  } catch (e) { next(e); }
});

router.post("/items", allowMethods("POST"), requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    const body = z.object({ productId: z.string().uuid() }).strict().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "invalid request body" }); return; }
    assertCan(actor, "update", { kind: "wishlist", ownerId: actor.id });
    const wid = await ownWishlistId(actor.id);
    await withActor(actor, (tx) =>
      tx.insert(wishlistItems).values({ id: uuidv7(), wishlistId: wid, productId: body.data.productId }).onConflictDoNothing()
    );
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/share", allowMethods("POST"), requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = getActor(req)!;
    assertCan(actor, "update", { kind: "wishlist", ownerId: actor.id });
    const wid = await ownWishlistId(actor.id);
    const token = randomBytes(24).toString("base64url");
    await withActor(actor, (tx) =>
      tx.update(wishlists).set({ shareToken: token, isPublic: true }).where(eq(wishlists.id, wid))
    );
    res.json({ shareToken: token });
  } catch (e) { next(e); }
});

router.get("/shared/:token", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = z.string().min(16).max(64).safeParse(req.params.token);
    if (!token.success) { res.status(404).json({ error: "not found" }); return; }

    const rows = await db
      .select({ id: wishlists.id, isPublic: wishlists.isPublic, ownerId: wishlists.userId })
      .from(wishlists)
      .where(and(eq(wishlists.shareToken, token.data), eq(wishlists.isPublic, true)))
      .limit(1);
    if (rows.length === 0) { res.status(404).json({ error: "not found" }); return; }

    if (!can(null, "wishlist:view-shared", { kind: "wishlist", ownerId: rows[0].ownerId, isPublic: true, hasValidShareToken: true })) {
      res.status(404).json({ error: "not found" }); return;
    }
    const items = await db
      .select({ productId: wishlistItems.productId, name: products.name, slug: products.slug })
      .from(wishlistItems).innerJoin(products, eq(products.id, wishlistItems.productId))
      .where(eq(wishlistItems.wishlistId, rows[0].id)).limit(200);
    res.json({ items });
  } catch (e) { next(e); }
});

export default router;
