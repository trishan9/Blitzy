import PDFDocument from "pdfkit";
import { DEMO } from "../security/demo-flags";

export interface InvoiceLine {
  productName: string;
  quantity: number;
  unitPricePaisa: bigint;
}

export interface InvoiceData {
  orderNo: string;
  issuedAt: Date;
  customerName: string;
  shipCity: string;
  shipCountry: string;
  lines: InvoiceLine[];
  subtotalPaisa: bigint;
  discountPaisa: bigint;
  deliveryFeePaisa: bigint;
  taxPaisa: bigint;
  totalPaisa: bigint;
}

export function formatPaisa(paisa: bigint, currency = "₹"): string {
  const neg = paisa < 0n;
  const abs = neg ? -paisa : paisa;
  const major = abs / 100n;
  const minor = abs % 100n;
  return `${neg ? "-" : ""}${currency}${major.toLocaleString("en-IN")}.${minor.toString().padStart(2, "0")}`;
}

export async function renderInvoicePdf(
  data: InvoiceData,
  opts: { compress?: boolean } = {}
): Promise<Buffer> {
  if (DEMO.SHELL_OUT_FOR_PDF) return shellOutForDemo(data);

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, compress: opts.compress !== false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).text("Invoice", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Order: ${data.orderNo}`);
    doc.text(`Issued: ${data.issuedAt.toISOString().slice(0, 10)}`);
    doc.moveDown(0.5);

    doc.text(`Billed to: ${data.customerName}`);
    doc.text(`Ship to: ${data.shipCity}, ${data.shipCountry}`);
    doc.moveDown();

    doc.fontSize(11).text("Items", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10);
    for (const line of data.lines) {
      const lineTotal = line.unitPricePaisa * BigInt(line.quantity);
      doc.text(
        `${line.quantity} x ${line.productName}  —  ${formatPaisa(line.unitPricePaisa)}  =  ${formatPaisa(lineTotal)}`
      );
    }

    doc.moveDown();
    doc.text(`Subtotal:  ${formatPaisa(data.subtotalPaisa)}`);
    if (data.discountPaisa > 0n) doc.text(`Discount:  -${formatPaisa(data.discountPaisa)}`);
    doc.text(`Delivery:  ${formatPaisa(data.deliveryFeePaisa)}`);
    doc.text(`Tax:       ${formatPaisa(data.taxPaisa)}`);
    doc.moveDown(0.3);
    doc.fontSize(12).text(`Total:     ${formatPaisa(data.totalPaisa)}`);

    doc.end();
  });
}

async function shellOutForDemo(data: InvoiceData): Promise<Buffer> {
  if (!DEMO.SHELL_OUT_FOR_PDF) throw new Error("shell-out PDF path is demo-only");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  const out = execSync(`echo "Invoice for ${data.orderNo}"`, { shell: "/bin/sh" });
  return Buffer.from(out);
}
