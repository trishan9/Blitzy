import "dotenv/config";
import { esewaSignature, verifyEsewaSignature, buildEsewaPayment, esewaConfig } from "../payments/esewa";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

const cfg = esewaConfig();
const signed = ["total_amount", "transaction_uuid", "product_code"];
const fields = { total_amount: "1000.00", transaction_uuid: "ORD-1", product_code: "EPAYTEST" };

const sig = esewaSignature(cfg.secretKey, fields, signed);
ok(sig.length > 20, "signature produced (base64 HMAC-SHA256)");
ok(verifyEsewaSignature(cfg.secretKey, fields, signed, sig), "valid signature verifies");
ok(!verifyEsewaSignature(cfg.secretKey, fields, signed, sig.slice(0, -2) + "XX"), "tampered signature rejected");
ok(!verifyEsewaSignature("wrong-secret", fields, signed, sig), "wrong secret rejected");

const tampered = { ...fields, total_amount: "1.00" };
ok(!verifyEsewaSignature(cfg.secretKey, tampered, signed, sig), "AMOUNT TAMPERING rejected (Rs.1000 -> Rs.1)");
ok(esewaSignature(cfg.secretKey, tampered, signed) !== sig, "different amount produces a different signature");

ok(!verifyEsewaSignature(cfg.secretKey, { ...fields, transaction_uuid: "ORD-2" }, signed, sig),
   "signature is bound to the transaction_uuid (replay across orders rejected)");

const init = buildEsewaPayment({
  transactionUuid: "ORD-9", totalPaisa: 1234567n,
  successUrl: "http://localhost:8000/api/payments/esewa/success",
  failureUrl: "http://localhost:5173/checkout?payment=failed",
});
ok(init.fields.total_amount === "12345.67", `paisa->rupees conversion exact (${init.fields.total_amount})`);
ok(init.fields.amount === init.fields.total_amount, "amount matches total_amount");
ok(!!init.fields.signature, "initiation is signed");
ok(init.formUrl.includes("esewa.com.np"), "posts to eSewa");
ok(verifyEsewaSignature(cfg.secretKey, init.fields, init.fields.signed_field_names.split(","), init.fields.signature),
   "initiation signature self-verifies");
ok(!("clientTotal" in init.fields) && !("price" in init.fields), "no client-supplied money field exists");

console.log(`\neSewa: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
