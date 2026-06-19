
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { withActor, withActorSerializable, type Actor } from "../db/client";
import { evaluateCoupon, type CouponInput } from "../coupons/apply";
import { encrypt } from "../security/crypto";
import { DEMO } from "../security/demo-flags";

export class CheckoutError extends Error {
  readonly httpStatus: number;
  constructor(readonly reason: string, httpStatus = 409) {
    super(reason);
    this.name = "CheckoutError";
    this.httpStatus = httpStatus;
  }
}

export interface CheckoutInput {
  addressId: string;
  couponCode?: string;
  paymentMethod: "CARD" | "CASH_ON_DELIVERY" | "ESEWA";
  idempotencyKey?: string;
  clientTotalPaisa?: bigint;
}

export interface CheckoutResult {
  orderId: string;
  orderNo: string;
  subtotalPaisa: bigint;
  discountPaisa: bigint;
  deliveryFeePaisa: bigint;
  taxPaisa: bigint;
  totalPaisa: bigint;
}

const FREE_DELIVERY_THRESHOLD_PAISA = 100_000n;
const DELIVERY_FEE_PAISA = 5_000n;
const TAX_BPS = 1300n;

function computeDeliveryFee(subtotalPaisa: bigint): bigint {
  return subtotalPaisa >= FREE_DELIVERY_THRESHOLD_PAISA ? 0n : DELIVERY_FEE_PAISA;
}

function computeTax(taxablePaisa: bigint): bigint {
  return (taxablePaisa * TAX_BPS) / 10_000n;
}

function generateOrderNo(): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `ORD-${stamp}-${Math.floor(Math.random() * 1e9).toString(36).toUpperCase()}`;
}

export async function checkout(actor: Actor, input: CheckoutInput): Promise<CheckoutResult> {
  if (!actor) throw new CheckoutError("authentication required", 401);
  const userId = actor.id;

  const runner = <T,>(fn: (tx: any) => Promise<T>): Promise<T> =>
    DEMO.NON_ATOMIC_STOCK
      ?
        withActor(actor, fn)
      : withActorSerializable(actor, fn);

  return runner<CheckoutResult>(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.execute(sql`
        SELECT response_hash FROM idempotency_keys
        WHERE user_id = ${userId} AND key = ${input.idempotencyKey}
          AND method = 'POST' AND path = '/api/orders/checkout'
        LIMIT 1
      `);
      if (existing.rows.length > 0) {
        throw new CheckoutError("duplicate request (idempotency key already used)", 409);
      }
    }

    const cartRes = await tx.execute(sql`
      SELECT id FROM carts WHERE user_id = ${userId} LIMIT 1
    `);
    const cart = cartRes.rows[0] as { id: string } | undefined;
    if (!cart) throw new CheckoutError("cart is empty", 400);

    const itemsRes = await tx.execute(sql`
      SELECT ci.product_id, ci.quantity,
             p.name, p.sale_price_paisa, p.original_price_paisa, p.discount_percent,
             p.stock, p.per_order_limit, p.is_active,
             -- The primary image, snapshotted alongside the name and the price. Without it the
             -- order history renders a broken image for every line, because product_images can
             -- change or be deleted long after the order was placed.
             (SELECT pi.url FROM product_images pi
               WHERE pi.product_id = p.id ORDER BY pi.position, pi.created_at LIMIT 1) AS image_url
      FROM cart_items ci
      JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = ${cart.id}
      ORDER BY ci.product_id
    `);
    const items = itemsRes.rows as Array<{
      product_id: string; quantity: number; name: string;
      sale_price_paisa: string; original_price_paisa: string; discount_percent: number;
      stock: number; per_order_limit: number; is_active: boolean; image_url: string | null;
    }>;
    if (items.length === 0) throw new CheckoutError("cart is empty", 400);

    let subtotalPaisa = 0n;
    for (const it of items) {
      if (!it.is_active) throw new CheckoutError(`product unavailable: ${it.name}`, 409);
      if (!Number.isInteger(it.quantity) || it.quantity < 1) {
        throw new CheckoutError("invalid quantity", 400);
      }
      if (it.quantity > it.per_order_limit) {
        throw new CheckoutError(`per-order limit exceeded for ${it.name}`, 409);
      }
      subtotalPaisa += BigInt(it.sale_price_paisa) * BigInt(it.quantity);
    }

    let discountPaisa = 0n;
    let couponId: string | null = null;
    if (input.couponCode) {
      const cRes = await tx.execute(sql`
        SELECT id, code, type, value, min_spend_paisa, max_redemptions, times_redeemed,
               per_user_limit, starts_at, expires_at, active, stackable
        FROM coupons WHERE code = ${input.couponCode} LIMIT 1
      `);
      const c = cRes.rows[0] as any;
      if (!c) throw new CheckoutError("invalid coupon", 400);

      const usedRes = await tx.execute(sql`
        SELECT count(*)::int AS n FROM coupon_redemptions
        WHERE coupon_id = ${c.id} AND user_id = ${userId}
      `);
      const userRedemptionCount = (usedRes.rows[0] as { n: number }).n;

      const coupon: CouponInput = {
        code: c.code, type: c.type, value: BigInt(c.value),
        minSpendPaisa: BigInt(c.min_spend_paisa),
        maxRedemptions: c.max_redemptions === null ? null : Number(c.max_redemptions),
        timesRedeemed: Number(c.times_redeemed),
        perUserLimit: Number(c.per_user_limit),
        startsAt: c.starts_at ? new Date(c.starts_at) : null,
        expiresAt: c.expires_at ? new Date(c.expires_at) : null,
        active: c.active, stackable: c.stackable,
      };

      const verdict = evaluateCoupon(coupon, {
        subtotalPaisa,
        now: new Date(), // SERVER time (§7.12)
        userRedemptionCount,
        otherCouponAlreadyApplied: false,
      });
      if (!verdict.ok) throw new CheckoutError(`coupon rejected: ${verdict.reason}`, 409);
      discountPaisa = verdict.discountPaisa;
      couponId = c.id;
    }

    const taxablePaisa = subtotalPaisa - discountPaisa;
    const deliveryFeePaisa = computeDeliveryFee(taxablePaisa);
    const taxPaisa = computeTax(taxablePaisa);
    const serverTotalPaisa = taxablePaisa + deliveryFeePaisa + taxPaisa;
    const totalPaisa =
      DEMO.TRUST_CLIENT_TOTAL && input.clientTotalPaisa !== undefined
        ? input.clientTotalPaisa
        : serverTotalPaisa;
    if (totalPaisa < 0n) throw new CheckoutError("computed total is negative", 500);

    const addrRes = await tx.execute(sql`
      SELECT recipient_name_encrypted, phone_encrypted, street_encrypted,
             city, state, postal_code_encrypted, country
      FROM addresses WHERE id = ${input.addressId} AND user_id = ${userId} LIMIT 1
    `);
    const addr = addrRes.rows[0] as any;
    if (!addr) throw new CheckoutError("address not found", 404);

    for (const it of items) {
      if (DEMO.NON_ATOMIC_STOCK) {
        const cur = await tx.execute(sql`SELECT stock FROM products WHERE id = ${it.product_id}`);
        const stock = Number((cur.rows[0] as { stock: number }).stock);
        if (stock < it.quantity) throw new CheckoutError(`out of stock: ${it.name}`, 409);
        await tx.execute(sql`UPDATE products SET stock = ${stock - it.quantity} WHERE id = ${it.product_id}`);
        continue;
      }
      const upd = await tx.execute(sql`
        UPDATE products SET stock = stock - ${it.quantity}
        WHERE id = ${it.product_id} AND stock >= ${it.quantity}
      `);
      if (upd.rowCount === 0) throw new CheckoutError(`out of stock: ${it.name}`, 409);
    }

    if (couponId) {
      const redeem = await tx.execute(sql`
        UPDATE coupons SET times_redeemed = times_redeemed + 1
        WHERE id = ${couponId}
          AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)
      `);
      if (redeem.rowCount === 0) throw new CheckoutError("coupon fully redeemed", 409);
      await tx.execute(sql`
        INSERT INTO coupon_redemptions (id, coupon_id, user_id)
        VALUES (${uuidv7()}, ${couponId}, ${userId})
      `);
    }

    const orderId = uuidv7();
    const orderNo = generateOrderNo();
    await tx.execute(sql`
      INSERT INTO orders (
        id, user_id, order_no,
        ship_recipient_encrypted, ship_phone_encrypted, ship_street_encrypted,
        ship_city, ship_state, ship_postal_encrypted, ship_country,
        payment_method, payment_status, status,
        subtotal_paisa, discount_paisa, delivery_fee_paisa, tax_paisa, total_paisa, coupon_id
      ) VALUES (
        ${orderId}, ${userId}, ${orderNo},
        ${addr.recipient_name_encrypted}, ${addr.phone_encrypted}, ${addr.street_encrypted},
        ${addr.city}, ${addr.state}, ${addr.postal_code_encrypted}, ${addr.country},
        ${input.paymentMethod}, 'PENDING', 'PENDING_PAYMENT',
        ${subtotalPaisa}, ${discountPaisa}, ${deliveryFeePaisa}, ${taxPaisa}, ${totalPaisa}, ${couponId}
      )
    `);

    for (const it of items) {
      await tx.execute(sql`
        INSERT INTO order_items (
          id, order_id, product_id, product_name, image_url, unit_price_paisa,
          original_price_paisa, discount_percent, quantity
        ) VALUES (
          ${uuidv7()}, ${orderId}, ${it.product_id}, ${it.name}, ${it.image_url ?? null},
          ${BigInt(it.sale_price_paisa)},
          ${BigInt(it.original_price_paisa)}, ${it.discount_percent}, ${it.quantity}
        )
      `);
    }

    await tx.execute(sql`
      INSERT INTO order_status_history (id, order_id, status, note)
      VALUES (${uuidv7()}, ${orderId}, 'PENDING_PAYMENT', 'order created')
    `);

    await tx.execute(sql`DELETE FROM cart_items WHERE cart_id = ${cart.id}`);

    if (input.idempotencyKey) {
      await tx.execute(sql`
        INSERT INTO idempotency_keys (id, user_id, key, method, path, response_hash)
        VALUES (${uuidv7()}, ${userId}, ${input.idempotencyKey}, 'POST', '/api/orders/checkout', ${orderId})
      `);
    }

    await tx.execute(sql`
      INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id, metadata)
      VALUES (${uuidv7()}, ${userId}, 'ORDER_CREATED', 'order', ${orderId},
              ${JSON.stringify({ totalPaisa: totalPaisa.toString(), items: items.length })}::jsonb)
    `);

    return { orderId, orderNo, subtotalPaisa, discountPaisa, deliveryFeePaisa, taxPaisa, totalPaisa };
  });
}

export const _pricing = { computeDeliveryFee, computeTax, FREE_DELIVERY_THRESHOLD_PAISA, DELIVERY_FEE_PAISA, TAX_BPS };
export { encrypt as _encrypt };
