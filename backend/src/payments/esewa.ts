import { createHmac, timingSafeEqual } from "node:crypto";

export interface EsewaConfig {
  merchantCode: string;
  secretKey: string;
  formUrl: string;
  statusUrl: string;
}

export function esewaConfig(): EsewaConfig {
  const sandbox = process.env.ESEWA_ENV !== "live";
  return {
    merchantCode: process.env.ESEWA_MERCHANT_CODE ?? "EPAYTEST",
    secretKey: process.env.ESEWA_SECRET_KEY ?? "8gBm/:&EnhH.1/q",
    formUrl: sandbox
      ? "https://rc-epay.esewa.com.np/api/epay/main/v2/form"
      : "https://epay.esewa.com.np/api/epay/main/v2/form",
    statusUrl: sandbox
      ? "https://rc.esewa.com.np/api/epay/transaction/status/"
      : "https://esewa.com.np/api/epay/transaction/status/",
  };
}

export function esewaSignature(secret: string, fields: Record<string, string>, signedFieldNames: string[]): string {
  const message = signedFieldNames.map((f) => `${f}=${fields[f]}`).join(",");
  return createHmac("sha256", secret).update(message).digest("base64");
}

export function verifyEsewaSignature(
  secret: string, fields: Record<string, string>, signedFieldNames: string[], provided: string
): boolean {
  const expected = esewaSignature(secret, fields, signedFieldNames);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided ?? "", "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface EsewaInitiation {
  formUrl: string;
  fields: Record<string, string>;
}

export function buildEsewaPayment(opts: {
  transactionUuid: string;
  totalPaisa: bigint;
  successUrl: string;
  failureUrl: string;
}): EsewaInitiation {
  const cfg = esewaConfig();
  const amount = (Number(opts.totalPaisa) / 100).toFixed(2);

  const fields: Record<string, string> = {
    amount,
    tax_amount: "0",
    total_amount: amount,
    transaction_uuid: opts.transactionUuid,
    product_code: cfg.merchantCode,
    product_service_charge: "0",
    product_delivery_charge: "0",
    success_url: opts.successUrl,   // built from APP_URL, never from a request header (§23)
    failure_url: opts.failureUrl,
    signed_field_names: "total_amount,transaction_uuid,product_code",
  };
  fields.signature = esewaSignature(cfg.secretKey, fields, [
    "total_amount", "transaction_uuid", "product_code",
  ]);

  return { formUrl: cfg.formUrl, fields };
}

export interface EsewaVerification {
  ok: boolean;
  reason?: string;
  gatewayTxnId?: string;
  amountPaisa?: bigint;
}

export async function verifyEsewaReturn(encoded: string, expectedTotalPaisa: bigint): Promise<EsewaVerification> {
  const cfg = esewaConfig();

  let payload: Record<string, string>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed-payload" };
  }

  const signedNames = (payload.signed_field_names ?? "").split(",").filter(Boolean);
  if (signedNames.length === 0) return { ok: false, reason: "no-signed-fields" };

  if (!verifyEsewaSignature(cfg.secretKey, payload, signedNames, payload.signature)) {
    return { ok: false, reason: "bad-signature" };
  }
  if (payload.status !== "COMPLETE") return { ok: false, reason: `status-${payload.status}` };

  const url = `${cfg.statusUrl}?product_code=${encodeURIComponent(cfg.merchantCode)}` +
    `&total_amount=${encodeURIComponent(payload.total_amount)}` +
    `&transaction_uuid=${encodeURIComponent(payload.transaction_uuid)}`;

  let confirmed: { status?: string; total_amount?: number; ref_id?: string };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `status-api-${res.status}` };
    confirmed = (await res.json()) as typeof confirmed;
  } catch {
    return { ok: false, reason: "status-api-unreachable" };
  }
  if (confirmed.status !== "COMPLETE") return { ok: false, reason: "not-confirmed" };

  const reportedPaisa = BigInt(Math.round(Number(confirmed.total_amount ?? payload.total_amount) * 100));
  if (reportedPaisa !== expectedTotalPaisa) {
    return { ok: false, reason: "amount-mismatch" };
  }

  return {
    ok: true,
    gatewayTxnId: String(confirmed.ref_id ?? payload.transaction_code ?? payload.transaction_uuid),
    amountPaisa: reportedPaisa,
  };
}
