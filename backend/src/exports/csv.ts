const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (DANGEROUS_LEAD.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return lines.join("\r\n") + "\r\n";
}

export class CsvRejected extends Error {
  readonly httpStatus = 400;
  constructor(readonly reason: string) {
    super("the CSV could not be imported");
    this.name = "CsvRejected";
  }
}

export const CSV_LIMITS = { maxBytes: 1_000_000, maxRows: 5000, maxFieldLen: 1000, maxCols: 20 };

export function parseCsv(input: string): string[][] {
  if (input.length > CSV_LIMITS.maxBytes) throw new CsvRejected("file-too-large");

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    if (field.length > CSV_LIMITS.maxFieldLen) throw new CsvRejected("field-too-long");
    row.push(field);
    field = "";
    if (row.length > CSV_LIMITS.maxCols) throw new CsvRejected("too-many-columns");
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
    if (rows.length > CSV_LIMITS.maxRows) throw new CsvRejected("too-many-rows");
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n") {
      pushField();
      pushRow();
    } else if (c === "\r") {
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { pushField(); pushRow(); }
  if (inQuotes) throw new CsvRejected("unterminated-quote");
  return rows;
}
