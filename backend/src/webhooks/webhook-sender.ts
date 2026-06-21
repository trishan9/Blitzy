import { createHmac, timingSafeEqual } from "node:crypto";
import { safeFetch } from "../security/safe-fetch";

export interface WebhookPayload {
  event: string;
  orderId: string;
  status: string;
  at: string;
}

export function signPayload(secret: string, body: string, timestamp: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(secret: string, body: string, timestamp: string, sig: string): boolean {
  const expected = signPayload(secret, body, timestamp);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SendResult {
  delivered: boolean;
  status?: number;
  reason?: string;
}

export async function sendWebhook(
  url: string,
  secret: string,
  payload: WebhookPayload
): Promise<SendResult> {
  const body = JSON.stringify(payload);
  const timestamp = payload.at;
  const signature = signPayload(secret, body, timestamp);

  try {
    const { validateUrl } = await import("../security/safe-fetch");
    await validateUrl(url);
  } catch (e) {
    return { delivered: false, reason: (e as Error).message };
  }

  try {
    const res = await safeFetch(url);
    return { delivered: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e) {
    return { delivered: false, reason: (e as Error).message };
  }
}
