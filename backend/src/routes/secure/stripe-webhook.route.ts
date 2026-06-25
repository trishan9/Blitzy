
import { Router, type Request, type Response, type NextFunction } from "express";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { asSystem } from "../../db/client";
import { verifyStripeEvent, isHandled, amountMatches } from "../../payments/stripe-webhook";
import { assertTransition, type OrderStatus } from "../../orders/state-machine";
import { logger } from "../../observability/logger";

const router = Router();

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  let event;
  try {
    event = verifyStripeEvent(req.body as Buffer, req.headers["stripe-signature"] as string | undefined);
  } catch (e) {
    logger.warn({ err: e }, "stripe webhook rejected");
    res.status(400).json({ error: "invalid webhook" });
    return;
  }

  if (!isHandled(event.type)) {
    res.json({ received: true, handled: false });
    return;
  }

  try {
    await asSystem(async (tx) => {
      const obj = event.data.object as unknown as Record<string, unknown>;
      const orderId = (obj.metadata as Record<string, string> | undefined)?.orderId;
      const gatewayTxnId = String(obj.id ?? "");
      if (!orderId) {
        logger.warn({ eventType: event.type }, "stripe webhook without orderId metadata");
        return;
      }

      const cur = await tx.execute(sql`
        SELECT id, status, total_paisa, user_id FROM orders WHERE id = ${orderId} FOR UPDATE
      `);
      const order = cur.rows[0] as
        | { id: string; status: OrderStatus; total_paisa: string; user_id: string }
        | undefined;
      if (!order) {
        logger.warn({ orderId }, "stripe webhook for unknown order");
        return;
      }

      if (event.type === "payment_intent.succeeded" || event.type === "checkout.session.completed") {
        const reported = Number(obj.amount_total ?? obj.amount_received ?? obj.amount ?? -1);
        if (!amountMatches(BigInt(order.total_paisa), reported)) {
          logger.error(
            { orderId, expected: order.total_paisa, reported },
            "AMOUNT MISMATCH — refusing to mark paid"
          );
          await tx.execute(sql`
            INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id, metadata)
            VALUES (${uuidv7()}, NULL, 'PAYMENT_STATE_CHANGED', 'order', ${orderId},
                    ${JSON.stringify({ result: "amount_mismatch", expected: order.total_paisa, reported })}::jsonb)
          `);
          return;
        }

        assertTransition(order.status, "PAID");
        await tx.execute(sql`
          UPDATE orders SET status='PAID', payment_status='PAID', updated_at=now() WHERE id=${orderId}
        `);
        await tx.execute(sql`
          INSERT INTO payments (id, order_id, user_id, provider, gateway_txn_id, amount_paisa, status)
          VALUES (${uuidv7()}, ${orderId}, ${order.user_id}, 'stripe', ${gatewayTxnId},
                  ${order.total_paisa}, 'PAID')
          ON CONFLICT DO NOTHING
        `);
        await tx.execute(sql`
          INSERT INTO order_status_history (id, order_id, status, note)
          VALUES (${uuidv7()}, ${orderId}, 'PAID', 'stripe webhook')
        `);
      }
    });

    res.json({ received: true, handled: true });
  } catch (e) {
    next(e);
  }
});

export default router;
