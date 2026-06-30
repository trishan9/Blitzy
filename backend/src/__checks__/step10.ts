import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderInvoicePdf, formatPaisa } from "../invoices/invoice-pdf";
import { amountMatches, isHandled } from "../payments/stripe-webhook";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

(async () => {
  ok(formatPaisa(0n) === "₹0.00", "paisa zero");
  ok(formatPaisa(5n) === "₹0.05", "paisa sub-rupee");
  ok(formatPaisa(100000n) === "₹1,000.00", "paisa thousands");
  ok(formatPaisa(199n) === "₹1.99", "paisa rounding-free");

  const evil = `"; rm -rf / #  {{7*7}}  <script>alert(1)</script>  $(whoami)`;
  const mk = (compress: boolean) => renderInvoicePdf({
    orderNo: evil,
    issuedAt: new Date("2026-07-23"),
    customerName: evil,
    shipCity: "Kathmandu", shipCountry: "NP",
    lines: [{ productName: evil, quantity: 2, unitPricePaisa: 12500n }],
    subtotalPaisa: 25000n, discountPaisa: 0n, deliveryFeePaisa: 5000n,
    taxPaisa: 1500n, totalPaisa: 31500n,
  }, { compress });

  const pdf = await mk(true);
  ok(Buffer.isBuffer(pdf) && pdf.length > 500, "PDF generated from hostile input without error");
  ok(pdf.subarray(0, 5).toString() === "%PDF-", "valid PDF magic bytes");

  const rawSrc = readFileSync(join(__dirname, "../invoices/invoice-pdf.ts"), "utf8");
  const code = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const [secureCode, demoCode = ""] = code.split("async function shellOutForDemo");
  ok(!/child_process/.test(secureCode), "no child_process in the secure PDF path");
  ok(!/\beval\(|new Function\(/.test(code), "no eval / new Function anywhere in the PDF module");
  ok(!/res\.render\(|\.compile\(/.test(code), "no template engine — document built via drawing calls");
  ok(/child_process/.test(demoCode) && /DEMO\.SHELL_OUT_FOR_PDF/.test(demoCode),
     "the only child_process use is gated behind the demo flag");

  ok(amountMatches(31500n, 31500) === true, "amount matches");
  ok(amountMatches(31500n, 100) === false, "underpayment rejected");
  ok(amountMatches(31500n, 31501) === false, "off-by-one rejected");
  ok(amountMatches(31500n, -31500) === false, "negative rejected");
  ok(amountMatches(31500n, 3.5 as unknown as number) === false, "non-integer rejected");

  ok(isHandled("checkout.session.completed"), "known event handled");
  ok(!isHandled("customer.subscription.deleted"), "unknown event not handled");
  ok(!isHandled("__proto__"), "proto key not handled");

  console.log(`\nStep 10 (PDF + webhook): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
