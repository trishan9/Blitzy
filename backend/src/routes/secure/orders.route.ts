
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { withActor } from "../../db/client";
import { orders, orderStatusHistory, payments } from "../../db/schema";
import { checkout } from "../../checkout/checkout";
import { allowMethods, getActor, assertCan } from "../../authz/authorize";
import { requireAuth } from "../../middlewares/auth.middleware";
import { buildEsewaPayment } from "../../payments/esewa";
import { ORDER_COLUMNS, hydrateOrders } from "../../orders/serialize";
import { uuidv7 } from "uuidv7";

const router = Router();
const paisa = (v: bigint | string | null) => (v === null ? null : String(v));
const rupees = (v: bigint | string | null) => (v === null ? null : Number(v) / 100);

const checkoutBodySchema = z
  .object({
    addressId: z.string().uuid(),
    couponCode: z.string().trim().min(1).max(64).optional(),
    paymentMethod: z.enum(["CARD", "CASH_ON_DELIVERY", "ESEWA"]),
  })
  .strict();

router.post(
  "/checkout",
  allowMethods("POST"),
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = checkoutBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "invalid request body" });
        return;
      }
      const actor = getActor(req)!;
      assertCan(actor, "create", { kind: "order", ownerId: actor.id });

      const idem = req.headers["idempotency-key"];
      const idempotencyKey = typeof idem === "string" && idem.length <= 128 ? idem : undefined;

      const result = await checkout(actor, { ...parsed.data, idempotencyKey });

      let payment: Record<string, unknown> | null = null;
      if (parsed.data.paymentMethod === "ESEWA") {
        const txnUuid = `${result.orderNo}-${Date.now().toString(36)}`;
        await withActor(actor, (tx) => tx.insert(payments).values({
          id: uuidv7(), orderId: result.orderId, userId: actor.id, provider: "esewa",
          gatewayTxnId: txnUuid, amountPaisa: result.totalPaisa, currency: "NPR", status: "PENDING",
        }));
        const appUrl = (process.env.APP_URL ?? "http://localhost:8000").replace(/\/$/, "");
        const feUrl = (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
        payment = {
          provider: "esewa",
          ...buildEsewaPayment({
            transactionUuid: txnUuid,
            totalPaisa: result.totalPaisa,
            successUrl: `${appUrl}/api/payments/esewa/success?orderId=${result.orderId}`,
            failureUrl: `${feUrl}/checkout?payment=failed`,
          }),
        };
      }

      res.status(201).json({
        message: "Order placed",
        orderId: result.orderId,
        orderNo: result.orderNo,
        subtotalPaisa: paisa(result.subtotalPaisa),
        discountPaisa: paisa(result.discountPaisa),
        deliveryFeePaisa: paisa(result.deliveryFeePaisa),
        taxPaisa: paisa(result.taxPaisa),
        totalPaisa: paisa(result.totalPaisa),
        order: {
          _id: result.orderId,
          orderNo: result.orderNo,
          subtotal: rupees(result.subtotalPaisa),
          discount: rupees(result.discountPaisa),
          deliveryFee: rupees(result.deliveryFeePaisa),
          tax: rupees(result.taxPaisa),
          total: rupees(result.totalPaisa),
          paymentMethod: parsed.data.paymentMethod,
        },
        payment,
      });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/",
  allowMethods("GET"),
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      assertCan(actor, "list", { kind: "order", ownerId: actor.id });
      const out = await withActor(actor, async (tx) => {
        const rows = await tx
          .select(ORDER_COLUMNS)
          .from(orders)
          .where(eq(orders.userId, actor.id))
          .orderBy(desc(orders.createdAt))
          .limit(50);
        return hydrateOrders(rows, tx);
      });
      res.json({ message: "Orders fetched", orders: out });
    } catch (e) {
      next(e);
    }
  }
);

router.get(
  "/:id",
  allowMethods("GET"),
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const actor = getActor(req)!;
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({ error: "not found" });
        return;
      }

      const out = await withActor(actor, async (tx) => {
        const rows = await tx
          .select(ORDER_COLUMNS)
          .from(orders)
          .where(and(eq(orders.id, id.data), eq(orders.userId, actor.id)))
          .limit(1);
        if (rows.length === 0) return null;
        assertCan(actor, "read", { kind: "order", ownerId: rows[0].userId });
        const history = await tx
          .select({ status: orderStatusHistory.status, note: orderStatusHistory.note,
                    date: orderStatusHistory.createdAt })
          .from(orderStatusHistory)
          .where(eq(orderStatusHistory.orderId, id.data))
          .orderBy(orderStatusHistory.createdAt);
        const [order] = await hydrateOrders(rows, tx);
        return { ...order, statusHistory: history };
      });

      if (!out) {
        res.status(404).json({ error: "not found" });
        return;
      }
      res.json({ message: "Order fetched", order: out });
    } catch (e) {
      next(e);
    }
  }
);

export default router;
