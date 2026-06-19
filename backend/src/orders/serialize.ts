
import { inArray } from "drizzle-orm";
import { orders, orderItems } from "../db/schema";
import { decryptNullable } from "../security/crypto";

export const ORDER_COLUMNS = {
  id: orders.id, userId: orders.userId, orderNo: orders.orderNo,
  shipRecipient: orders.shipRecipientEncrypted, shipPhone: orders.shipPhoneEncrypted,
  shipStreet: orders.shipStreetEncrypted, shipPostal: orders.shipPostalEncrypted,
  shipCity: orders.shipCity, shipState: orders.shipState, shipCountry: orders.shipCountry,
  paymentMethod: orders.paymentMethod, paymentStatus: orders.paymentStatus, status: orders.status,
  subtotalPaisa: orders.subtotalPaisa, discountPaisa: orders.discountPaisa,
  deliveryFeePaisa: orders.deliveryFeePaisa, taxPaisa: orders.taxPaisa, totalPaisa: orders.totalPaisa,
  createdAt: orders.createdAt, updatedAt: orders.updatedAt,
} as const;

const rupees = (v: bigint | string | number | null) => (v === null ? 0 : Number(v) / 100);

export async function hydrateOrders(
  rows: any[],
  tx: any,
  opts: { includeUserId?: boolean } = {}
): Promise<any[]> {
  if (rows.length === 0) return [];

  const items = await tx.select({
    orderId: orderItems.orderId, productId: orderItems.productId,
    name: orderItems.productName, image: orderItems.imageUrl,
    unit: orderItems.unitPricePaisa, orig: orderItems.originalPricePaisa,
    quantity: orderItems.quantity,
  }).from(orderItems).where(inArray(orderItems.orderId, rows.map((r) => r.id)));

  const byOrder = new Map<string, any[]>();
  for (const it of items) {
    const l = byOrder.get(it.orderId) ?? [];
    l.push({
      productId: it.productId, name: it.name, image: it.image ?? "",
      originalPrice: rupees(it.orig), salePrice: rupees(it.unit), quantity: it.quantity,
    });
    byOrder.set(it.orderId, l);
  }

  return rows.map((o) => ({
    _id: o.id,
    ...(opts.includeUserId ? { userId: o.userId } : {}),
    orderNo: o.orderNo,
    items: byOrder.get(o.id) ?? [],
    shippingAddress: {
      recipientName: decryptNullable(o.shipRecipient, "pii:address") ?? "",
      phone: decryptNullable(o.shipPhone, "pii:phone") ?? "",
      street: decryptNullable(o.shipStreet, "pii:address") ?? "",
      city: o.shipCity, state: o.shipState,
      postalCode: decryptNullable(o.shipPostal, "pii:address") ?? "",
      country: o.shipCountry,
    },
    paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, status: o.status,
    subtotal: rupees(o.subtotalPaisa), deliveryFee: rupees(o.deliveryFeePaisa),
    tax: rupees(o.taxPaisa), discount: rupees(o.discountPaisa), total: rupees(o.totalPaisa),
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  }));
}
