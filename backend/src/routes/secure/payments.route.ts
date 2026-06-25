
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { withActor, asSystem } from "../../db/client";
import { orders, payments } from "../../db/schema";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { buildEsewaPayment, verifyEsewaReturn } from "../../payments/esewa";
import { assertTransition, type OrderStatus } from "../../orders/state-machine";
import { logger } from "../../observability/logger";

const router = Router();

const appUrl = () => (process.env.APP_URL ?? "http://localhost:8000").replace(/\/$/, "");
const frontendUrl = () => (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");

router.post("/esewa/initiate", allowMethods("POST"), requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      const body = z.object({ orderId: z.string().uuid() }).strict().safeParse(req.body);
      if (!body.success) { res.status(400).json({ message: "Invalid request" }); return; }

      const out = await withActor(actor, async (tx) => {
        const rows = await tx.select({
          id: orders.id, total: orders.totalPaisa, status: orders.status,
          paymentStatus: orders.paymentStatus, orderNo: orders.orderNo,
        }).from(orders)
          .where(and(eq(orders.id, body.data.orderId), eq(orders.userId, actor.id)))
          .limit(1);
        if (rows.length === 0) return null;
        const o = rows[0];
        if (o.paymentStatus === "PAID") { const e: any = new Error("Order already paid"); e.httpStatus = 409; throw e; }

        const txnUuid = `${o.orderNo}-${Date.now().toString(36)}`;
        await tx.insert(payments).values({
          id: uuidv7(), orderId: o.id, userId: actor.id, provider: "esewa",
          gatewayTxnId: txnUuid, amountPaisa: BigInt(o.total), currency: "NPR", status: "PENDING",
        });
        return { orderId: o.id, total: BigInt(o.total), txnUuid };
      });

      if (!out) { res.status(404).json({ message: "Not found" }); return; }

      const initiation = buildEsewaPayment({
        transactionUuid: out.txnUuid,
        totalPaisa: out.total,
        successUrl: `${appUrl()}/api/payments/esewa/success/${out.orderId}`,
        failureUrl: `${frontendUrl()}/orders/${out.orderId}?payment=cancelled`,
      });

      res.json({ message: "eSewa payment initiated", ...initiation });
    } catch (e) { next(e); }
  });

const esewaReturn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  let landing: string | null = null;
  const fail = (reason: string) => {
    logger.warn({ reason }, "esewa return rejected");
    res.redirect(landing ? `${frontendUrl()}/orders/${landing}?payment=failed`
                         : `${frontendUrl()}/orders?payment=failed`);
  };
  try {
    const one = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    let orderId: string | undefined = one(req.params.orderId) ?? one(req.query.orderId);
    let data: string | undefined = one(req.query.data);

    if (orderId?.includes("?")) {
      const [id, rest] = orderId.split("?", 2);
      orderId = id;
      const m = /(?:^|&)data=([^&]+)/.exec(rest ?? "");
      if (m && !data) data = decodeURIComponent(m[1]);
    }

    const q = z.object({
      orderId: z.string().uuid(),
      data: z.string().min(1).max(8192),
    }).safeParse({ orderId, data });
    if (!q.success) return fail("bad-query");
    landing = q.data.orderId;

    const order = await asSystem(async (tx) => {
      const rows = await tx.select({
        id: orders.id, total: orders.totalPaisa, status: orders.status,
        paymentStatus: orders.paymentStatus, userId: orders.userId,
      }).from(orders).where(eq(orders.id, q.data.orderId)).limit(1);
      return rows[0];
    });
    if (!order) return fail("unknown-order");
    if (order.paymentStatus === "PAID") {
      res.redirect(`${frontendUrl()}/orders/${order.id}?payment=success`);
      return;
    }

    const verdict = await verifyEsewaReturn(q.data.data, BigInt(order.total));
    if (!verdict.ok) {
      await asSystem((tx) => tx.execute(sql`
        INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id, metadata)
        VALUES (${uuidv7()}, ${order.userId}, 'PAYMENT_STATE_CHANGED', 'order', ${order.id},
                ${JSON.stringify({ provider: "esewa", result: "rejected", reason: verdict.reason })}::jsonb)
      `)).catch(() => undefined);
      return fail(verdict.reason ?? "verification-failed");
    }

    await asSystem(async (tx) => {
      assertTransition(order.status as OrderStatus, "PAID");
      await tx.execute(sql`
        UPDATE orders SET status='PAID', payment_status='PAID', updated_at=now() WHERE id=${order.id}
      `);
      await tx.execute(sql`
        INSERT INTO payments (id, order_id, user_id, provider, gateway_txn_id, amount_paisa, currency, status)
        VALUES (${uuidv7()}, ${order.id}, ${order.userId}, 'esewa', ${verdict.gatewayTxnId},
                ${verdict.amountPaisa!.toString()}, 'NPR', 'PAID')
        ON CONFLICT DO NOTHING
      `);
      await tx.execute(sql`
        INSERT INTO order_status_history (id, order_id, status, note)
        VALUES (${uuidv7()}, ${order.id}, 'PAID', 'eSewa payment verified')
      `);
      await tx.execute(sql`
        INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id, metadata)
        VALUES (${uuidv7()}, ${order.userId}, 'PAYMENT_STATE_CHANGED', 'order', ${order.id},
                ${JSON.stringify({ provider: "esewa", result: "paid", txn: verdict.gatewayTxnId })}::jsonb)
      `);
    });

    res.redirect(`${frontendUrl()}/orders/${order.id}?payment=success`);
  } catch (e) { next(e); }
};

router.get("/esewa/success/:orderId", allowMethods("GET"), esewaReturn);
router.get("/esewa/success", allowMethods("GET"), esewaReturn);

router.get("/methods", allowMethods("GET"), async (_req: Request, res: Response) => {
  res.json({
    message: "Payment methods",
    methods: [
      { id: "esewa", label: "eSewa", currency: "NPR", enabled: true },
      { id: "card", label: "Card (Stripe)", currency: "NPR", enabled: Boolean(process.env.STRIPE_SECRET_KEY) },
      { id: "cash_on_delivery", label: "Cash on Delivery", currency: "NPR", enabled: true },
    ],
  });
});

export default router;
