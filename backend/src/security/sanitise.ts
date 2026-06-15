import DOMPurify from "isomorphic-dompurify";
import { DEMO } from "./demo-flags";

const PROSE_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
  ALLOWED_TAGS: ["b", "i", "em", "strong", "p", "br", "ul", "ol", "li"],
  ALLOWED_ATTR: [],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "svg", "math"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "style", "srcset", "formaction"],
  ALLOW_DATA_ATTR: false,
};

export function sanitiseProse(input: string): string {
  if (DEMO.DISABLE_OUTPUT_SANITISE) return input;
  return String(DOMPurify.sanitize(input, PROSE_CONFIG));
}

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function isSafeUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return ALLOWED_URL_SCHEMES.has(u.protocol);
}
