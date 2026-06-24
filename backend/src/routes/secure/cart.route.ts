
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { withActor, withGuestCart } from "../../db/client";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import {
  verifyGuestCartCookie, makeGuestCartCookie, guestCartCookieOptions, GUEST_CART_COOKIE_NAME,
} from "../../auth/guest-cart";
import { uuidv7 } from "uuidv7";
import { _pricing } from "../../checkout/checkout";

const router = Router();

const addItemSchema = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000),
  })
  .strict();

const replaceCartSchema = z
  .object({ items: z.array(addItemSchema).max(100) })
  .strict();

const rupees = (paisa: bigint) => Number(paisa) / 100;

async function cartPayload(tx: any, cartId: string) {
  const cart: any = await tx.execute(sql`
    SELECT id, user_id, guest_cart_id, created_at, updated_at FROM carts WHERE id = ${cartId}
  `);
  const rows: any = await tx.execute(sql`
    SELECT ci.id AS item_id, ci.quantity,
           p.id AS product_id, p.name, p.slug, p.unit, p.stock,
           p.sale_price_paisa, p.original_price_paisa, p.discount_percent,
           (SELECT url FROM product_images WHERE product_id = p.id ORDER BY position LIMIT 1) AS image_url
    FROM cart_items ci JOIN products p ON p.id = ci.product_id
    WHERE ci.cart_id = ${cartId}
    ORDER BY p.name
  `);

  let subtotalPaisa = 0n;
  const items = (rows.rows as any[]).map((r) => {
    subtotalPaisa += BigInt(r.sale_price_paisa) * BigInt(r.quantity);
    return {
      _id: r.item_id,
      quantity: r.quantity,
      productId: {
        _id: r.product_id, name: r.name, slug: r.slug, unit: r.unit,
        images: r.image_url ? [r.image_url] : [],
        salePrice: rupees(BigInt(r.sale_price_paisa)),
        originalPrice: rupees(BigInt(r.original_price_paisa)),
        discountPercent: r.discount_percent,
        stockCount: r.stock,
      },
    };
  });

  const deliveryFeePaisa = _pricing.computeDeliveryFee(subtotalPaisa);
  const taxPaisa = _pricing.computeTax(subtotalPaisa);
  const c = cart.rows[0] as any;

  return {
    cart: c
      ? {
          _id: c.id, userId: c.user_id, guestCartId: c.guest_cart_id, items,
          createdAt: c.created_at, updatedAt: c.updated_at,
        }
      : null,
    subtotal: rupees(subtotalPaisa),
    deliveryFee: rupees(deliveryFeePaisa),
    freeDeliveryThreshold: rupees(_pricing.FREE_DELIVERY_THRESHOLD_PAISA),
    tax: rupees(taxPaisa),
    orderTotal: rupees(subtotalPaisa + deliveryFeePaisa + taxPaisa),
  };
}

async function assertSellable(tx: any, productId: string, quantity: number) {
  const p = await tx.execute(sql`
    SELECT stock, per_order_limit FROM products WHERE id = ${productId} AND is_active = true
  `);
  const prod = p.rows[0] as { stock: number; per_order_limit: number } | undefined;
  if (!prod) { const e: any = new Error("not found"); e.httpStatus = 404; throw e; }
  if (quantity > prod.per_order_limit) {
    const e: any = new Error("per-order limit exceeded"); e.httpStatus = 409; throw e;
  }
  if (quantity > prod.stock) {
    const e: any = new Error("insufficient stock"); e.httpStatus = 409; throw e;
  }
}

async function resolveCartId(req: Request, res: Response): Promise<{ cartId: string; guest: boolean; guestId?: string } | null> {
  const actor = getActor(req);
  if (actor) {
    const rows = await withActor(actor, async (tx) => {
      const found = await tx.execute(sql`SELECT id FROM carts WHERE user_id = ${actor.id} LIMIT 1`);
      if (found.rows.length > 0) return found.rows as { id: string }[];
      const id = uuidv7();
      await tx.execute(sql`INSERT INTO carts (id, user_id) VALUES (${id}, ${actor.id})`);
      return [{ id }];
    });
    return { cartId: (rows[0] as { id: string }).id, guest: false };
  }

  const verified = verifyGuestCartCookie(req.cookies?.[GUEST_CART_COOKIE_NAME]);
  if (verified) {
    const exists = await withGuestCart(verified, (tx) =>
      tx.execute(sql`SELECT id FROM carts WHERE guest_cart_id = ${verified} LIMIT 1`)
    );
    if (exists.rows.length > 0) return { cartId: (exists.rows[0] as { id: string }).id, guest: true, guestId: verified };
  }
  const guestId = uuidv7();
  const cartId = uuidv7();
  await withGuestCart(guestId, (tx) =>
    tx.execute(sql`INSERT INTO carts (id, guest_cart_id) VALUES (${cartId}, ${guestId})`)
  );
  const cookie = makeGuestCartCookie(guestId);
  res.cookie(cookie.name, cookie.value, guestCartCookieOptions);
  return { cartId, guest: true, guestId };
}

router.get("/", allowMethods("GET"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resolved = await resolveCartId(req, res);
    if (!resolved) { res.json({ message: "Cart fetched", cart: null, subtotal: 0, deliveryFee: 0, freeDeliveryThreshold: rupees(_pricing.FREE_DELIVERY_THRESHOLD_PAISA), tax: 0, orderTotal: 0 }); return; }
    const scoped = <T,>(fn: (tx: any) => Promise<T>) =>
      resolved.guest ? withGuestCart(resolved.guestId!, fn) : withActor(getActor(req)!, fn);
    const payload = await scoped((tx) => cartPayload(tx, resolved.cartId));
    res.json({ message: "Cart fetched", ...payload });
  } catch (e) { next(e); }
});

router.post("/", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = replaceCartSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid request body" }); return; }
    const actor = getActor(req);
    if (actor) assertCan(actor, "update", { kind: "cart", ownerId: actor.id });

    const resolved = await resolveCartId(req, res);
    if (!resolved) { res.status(400).json({ error: "no cart" }); return; }
    const scoped = <T,>(fn: (tx: any) => Promise<T>) =>
      resolved.guest ? withGuestCart(resolved.guestId!, fn) : withActor(getActor(req)!, fn);

    const payload = await scoped(async (tx) => {
      const unknown: string[] = [];
      for (const it of parsed.data.items) {
        const p = await tx.execute(sql`
          SELECT 1 FROM products WHERE id = ${it.productId} AND is_active = true
        `);
        if (p.rows.length === 0) unknown.push(it.productId);
      }
      if (unknown.length > 0) {
        const e: any = new Error("cart contains items that are no longer available");
        e.httpStatus = 409;
        e.expose = { unavailableProductIds: unknown };
        throw e;
      }
      for (const it of parsed.data.items) await assertSellable(tx, it.productId, it.quantity);
      await tx.execute(sql`DELETE FROM cart_items WHERE cart_id = ${resolved.cartId}`);
      for (const it of parsed.data.items) {
        await tx.execute(sql`
          INSERT INTO cart_items (id, cart_id, product_id, quantity)
          VALUES (${uuidv7()}, ${resolved.cartId}, ${it.productId}, ${it.quantity})
          ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = ${it.quantity}
        `);
      }
      await tx.execute(sql`UPDATE carts SET updated_at = now() WHERE id = ${resolved.cartId}`);
      return cartPayload(tx, resolved.cartId);
    });

    res.json({ message: "Cart updated", ...payload });
  } catch (e) { next(e); }
});

router.post("/items", allowMethods("POST"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = addItemSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "invalid request body" }); return; }
    const actor = getActor(req);
    if (actor) assertCan(actor, "update", { kind: "cart", ownerId: actor.id });

    const resolved = await resolveCartId(req, res);
    if (!resolved) { res.status(400).json({ error: "no cart" }); return; }
    const { productId, quantity } = parsed.data;

    const scoped = <T,>(fn: (tx: any) => Promise<T>) =>
      resolved.guest ? withGuestCart(resolved.guestId!, fn) : withActor(getActor(req)!, fn);
    const payload = await scoped(async (tx) => {
      await assertSellable(tx, productId, quantity);
      await tx.execute(sql`
        INSERT INTO cart_items (id, cart_id, product_id, quantity)
        VALUES (${uuidv7()}, ${resolved.cartId}, ${productId}, ${quantity})
        ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = ${quantity}
      `);
      return cartPayload(tx, resolved.cartId);
    });
    res.status(201).json({ message: "Item added", ...payload });
  } catch (e) { next(e); }
});

router.delete("/items/:productId", allowMethods("DELETE"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pid = z.string().uuid().safeParse(req.params.productId);
    if (!pid.success) { res.status(404).json({ error: "not found" }); return; }
    const resolved = await resolveCartId(req, res);
    if (!resolved) { res.status(404).json({ error: "not found" }); return; }
    const scoped = <T,>(fn: (tx: any) => Promise<T>) =>
      resolved.guest ? withGuestCart(resolved.guestId!, fn) : withActor(getActor(req)!, fn);
    await scoped((tx) =>
      tx.execute(sql`DELETE FROM cart_items WHERE cart_id = ${resolved.cartId} AND product_id = ${pid.data}`)
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
