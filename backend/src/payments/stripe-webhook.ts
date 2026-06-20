import Stripe from "stripe";
import { DEMO } from "../security/demo-flags";

export class WebhookRejected extends Error {
  readonly httpStatus = 400;
  constructor(readonly reason: string) {
    super("invalid webhook");
    this.name = "WebhookRejected";
  }
}

let client: Stripe | null = null;
export function stripeClient(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}

export function verifyStripeEvent(rawBody: Buffer, signatureHeader: string | undefined): Stripe.Event {
  if (DEMO.UNSAFE_DESERIALIZE) {
    return JSON.parse(rawBody.toString("utf8")) as Stripe.Event;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  if (!signatureHeader) throw new WebhookRejected("missing-signature");

  try {
    return stripeClient().webhooks.constructEvent(rawBody, signatureHeader, secret);
  } catch (e) {
    throw new WebhookRejected((e as Error).message);
  }
}

export function amountMatches(expectedPaisa: bigint, gatewayReportedMinorUnits: number): boolean {
  if (!Number.isInteger(gatewayReportedMinorUnits) || gatewayReportedMinorUnits < 0) return false;
  return expectedPaisa === BigInt(gatewayReportedMinorUnits);
}

export const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
]);

export function isHandled(eventType: string): boolean {
  return HANDLED_EVENTS.has(eventType);
}
