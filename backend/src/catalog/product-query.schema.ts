import { z } from "zod";
import { MAX_PAGE_SIZE } from "./product-query";

export const productListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    categoryId: z.string().uuid().optional(),
    minPricePaisa: z.coerce.number().int().min(0).optional(),
    maxPricePaisa: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    sort: z.enum(["price", "rating", "name", "created"]).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
    inStock: z.coerce.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => v.minPricePaisa == null || v.maxPricePaisa == null || v.minPricePaisa <= v.maxPricePaisa,
    { message: "minPricePaisa must be <= maxPricePaisa", path: ["minPricePaisa"] }
  );

export type ProductListQuery = z.infer<typeof productListQuerySchema>;
