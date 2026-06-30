import "dotenv/config";
import { signPayload, verifySignature, sendWebhook } from "../webhooks/webhook-sender";
import { parseCsv, CsvRejected, CSV_LIMITS, csvCell } from "../exports/csv";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

async function main() {
  process.env.SSRF_ALLOWED_HOSTS = "hooks.partner.example";

  const secret = "whsec_test";
  const body = JSON.stringify({ event: "order.shipped", orderId: "o1" });
  const ts = "2026-07-23T00:00:00Z";
  const sig = signPayload(secret, body, ts);
  ok(sig.length === 64, "HMAC-SHA256 signature produced");
  ok(verifySignature(secret, body, ts, sig), "valid signature verifies");
  ok(!verifySignature(secret, body, ts, sig.replace(/.$/, "0")), "tampered signature rejected");
  ok(!verifySignature("wrong", body, ts, sig), "wrong secret rejected");
  ok(signPayload(secret, body, "2026-01-01T00:00:00Z") !== sig, "different timestamp → different sig (replay-detectable)");

  const meta = await sendWebhook("http://169.254.169.254/latest/meta-data/", secret, { event: "x", orderId: "o", status: "PAID", at: ts });
  ok(!meta.delivered && !!meta.reason, "webhook to cloud metadata BLOCKED (SSRF guard on the endpoint URL)");
  const loop = await sendWebhook("http://127.0.0.1:5432/", secret, { event: "x", orderId: "o", status: "PAID", at: ts });
  ok(!loop.delivered, "webhook to loopback blocked");
  const nonAllow = await sendWebhook("https://evil.example/hook", secret, { event: "x", orderId: "o", status: "PAID", at: ts });
  ok(!nonAllow.delivered, "webhook to non-allowlisted host blocked");

  const rejects = (fn: () => void, m: string) => { try { fn(); ok(false, m + " should reject"); } catch (e) { ok(e instanceof CsvRejected, m + (e instanceof CsvRejected ? ` (${e.reason})` : "")); } };
  rejects(() => parseCsv("x".repeat(CSV_LIMITS.maxBytes + 1)), "oversized file rejected");
  rejects(() => parseCsv("h\n" + Array.from({ length: CSV_LIMITS.maxRows + 5 }, () => "a").join("\n")), "too many rows rejected");
  rejects(() => parseCsv("a," + "b".repeat(CSV_LIMITS.maxFieldLen + 1)), "over-long field rejected");
  rejects(() => parseCsv('"unterminated'), "unterminated quote rejected");
  rejects(() => parseCsv(Array.from({ length: CSV_LIMITS.maxCols + 2 }, () => "c").join(",")), "too many columns rejected");

  const parsed = parseCsv('name,price\n"Widget, Deluxe",100\n"He said ""hi""",200\n');
  ok(parsed.length === 3, "3 rows parsed (header + 2)");
  ok(parsed[1][0] === "Widget, Deluxe", "embedded comma preserved inside quotes");
  ok(parsed[2][0] === 'He said "hi"', "escaped quotes unescaped correctly");

  const imported = parseCsv('name\n"=cmd|calc"\n')[1][0];
  ok(csvCell(imported).startsWith(`"'=`), "imported formula value neutralised on re-export");

  console.log(`\nWebhooks + CSV import: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("fatal:", e); process.exit(1); });
