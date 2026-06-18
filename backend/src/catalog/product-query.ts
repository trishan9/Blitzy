import { asc, desc, type SQL } from "drizzle-orm";
import { products } from "../db/schema";
import { DEMO } from "../security/demo-flags";

export const SORTABLE = {
  price: products.salePricePaisa,
  rating: products.ratingAverage,
  name: products.name,
  created: products.createdAt,
} as const;

export type SortKey = keyof typeof SORTABLE;
export type SortDir = "asc" | "desc";

const DEFAULT_SORT: SortKey = "created";
const DEFAULT_DIR: SortDir = "desc";

export const MAX_PAGE_SIZE = 60;
export const DEFAULT_PAGE_SIZE = 20;

export function resolveOrderBy(rawSort?: string, rawDir?: string): SQL {
  const key: SortKey = rawSort != null && rawSort in SORTABLE ? (rawSort as SortKey) : DEFAULT_SORT;
  const dir: SortDir = rawDir === "asc" || rawDir === "desc" ? rawDir : DEFAULT_DIR;
  const column = SORTABLE[key];
  return dir === "asc" ? asc(column) : desc(column);
}

export function resolveOrderByNaiveForDemo(rawSort?: string, rawDir?: string): string {
  if (!DEMO.DISABLE_SQL_ALLOWLIST) {
    throw new Error("naive ORDER BY path is demo-only and must not be called in the secure app");
  }
  return `ORDER BY ${rawSort ?? "created_at"} ${rawDir ?? "desc"}`;
}

export function resolvePagination(rawPage?: unknown, rawSize?: unknown): {
  page: number;
  pageSize: number;
  offset: number;
} {
  const page = clampInt(rawPage, 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = clampInt(rawSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
