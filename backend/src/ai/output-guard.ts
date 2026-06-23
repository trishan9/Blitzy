import { z } from "zod";
import { DEMO } from "../security/demo-flags";

export const MAX_OUTPUT_CHARS = 4000;

export function stripMarkdownLinksAndImages(input: string): string {
  if (DEMO.RENDER_LLM_MARKDOWN) return input;

  let s = input;

  s = s.replace(/<\s*img\b[^>]*>/gi, "");
  s = s.replace(/<\s*\/?\s*(a|iframe|embed|object|script|style|link|svg|video|audio|source)\b[^>]*>/gi, "");

  s = s.replace(/^[ \t]*\[[^\]]*\]:[ \t]*\S+.*$/gim, "");

  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  s = s.replace(/<\s*(?:https?|mailto|data|javascript|file|ftp):[^>]*>/gi, "");

  s = s.replace(/\b(?:https?|data|javascript|file|ftp):\/*/gi, "");

  return s;
}

export function capLength(input: string, max = MAX_OUTPUT_CHARS): string {
  return input.length <= max ? input : input.slice(0, max);
}

export function sanitiseModelText(input: string): string {
  return capLength(stripMarkdownLinksAndImages(input)).trim();
}

export const assistantResponseSchema = z
  .object({
    answer: z.string().max(MAX_OUTPUT_CHARS),
    recommendedProductIds: z.array(z.string().uuid()).max(5).default([]),
    citedReviewIds: z.array(z.string().uuid()).max(10).default([]),
  })
  .strict();

export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export type GuardOutcome =
  | { ok: true; response: AssistantResponse; dropped: string[] }
  | { ok: false; reason: "invalid-json" | "schema-violation" | "canary-leaked" };

export function guardModelOutput(
  raw: string,
  allowedProductIds: ReadonlySet<string>,
  allowedReviewIds: ReadonlySet<string>
): GuardOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  const result = assistantResponseSchema.safeParse(parsed);
  if (!result.success) return { ok: false, reason: "schema-violation" };

  const dropped: string[] = [];
  const groundedProducts = result.data.recommendedProductIds.filter((id) => {
    const keep = allowedProductIds.has(id);
    if (!keep) dropped.push(id);
    return keep;
  });
  const groundedReviews = result.data.citedReviewIds.filter((id) => {
    const keep = allowedReviewIds.has(id);
    if (!keep) dropped.push(id);
    return keep;
  });

  return {
    ok: true,
    dropped,
    response: {
      answer: sanitiseModelText(result.data.answer),
      recommendedProductIds: groundedProducts,
      citedReviewIds: groundedReviews,
    },
  };
}
