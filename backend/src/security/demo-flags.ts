type FlagMeta = {
  readonly key: string;
  readonly class: string;
  readonly cwe: string;
  readonly endpoint: string;
};

const on = (key: string): boolean => process.env[key] === "true";

export const DEMO_FLAG_REGISTRY: readonly FlagMeta[] = [
  { key: "DISABLE_SQL_ALLOWLIST", class: "SQL injection (ORDER BY)", cwe: "CWE-89", endpoint: "GET /api/products" },
  { key: "DISABLE_OUTPUT_SANITISE", class: "Stored XSS", cwe: "CWE-79", endpoint: "POST /api/reviews" },
  { key: "DISABLE_CSRF", class: "CSRF", cwe: "CWE-352", endpoint: "POST /api/*" },
  { key: "REFLECT_CORS_ORIGIN", class: "CORS misconfiguration", cwe: "CWE-942", endpoint: "* (preflight)" },
  { key: "DISABLE_SSRF_GUARD", class: "SSRF", cwe: "CWE-918", endpoint: "POST /api/products/image-from-url" },
  { key: "SHELL_OUT_FOR_PDF", class: "Command injection", cwe: "CWE-78", endpoint: "GET /api/orders/:id/invoice" },
  { key: "TRUST_UPLOAD_FILENAME", class: "Path traversal", cwe: "CWE-22", endpoint: "POST /api/products/:id/images" },
  { key: "DISABLE_LOCKOUT", class: "Broken brute-force protection", cwe: "CWE-307", endpoint: "POST /api/auth/sign-in" },
  { key: "TRUST_CLIENT_TOTAL", class: "Business logic (client-controlled price)", cwe: "CWE-840", endpoint: "POST /api/orders/checkout" },
  { key: "NON_ATOMIC_STOCK", class: "Race condition (oversell)", cwe: "CWE-362", endpoint: "POST /api/orders/checkout" },
  { key: "TRUST_UPLOAD_MIMETYPE", class: "Unrestricted file upload", cwe: "CWE-434", endpoint: "POST /api/products/:id/images" },
  { key: "VERBOSE_ERRORS", class: "Information disclosure", cwe: "CWE-209", endpoint: "* (error handler)" },
  { key: "RENDER_LLM_MARKDOWN", class: "LLM output exfiltration", cwe: "CWE-79", endpoint: "POST /api/ai/assistant" },
  { key: "UNSAFE_DESERIALIZE", class: "Insecure deserialization", cwe: "CWE-502", endpoint: "* (varies)" },
  { key: "MONGO_RAW_FILTER", class: "NoSQL injection", cwe: "CWE-943", endpoint: "GET /api/admin/activity" },
  { key: "USE_NAIVE_JWT_VERIFIER", class: "JWT (umbrella switch)", cwe: "CWE-347", endpoint: "* (auth middleware)" },
  { key: "JWT_ACCEPT_ALG_NONE", class: "JWT alg:none", cwe: "CWE-347", endpoint: "* (auth middleware)" },
  { key: "JWT_SKIP_VERIFY", class: "JWT unverified signature", cwe: "CWE-347", endpoint: "* (auth middleware)" },
  { key: "JWT_ALLOW_HS256", class: "JWT algorithm confusion", cwe: "CWE-347", endpoint: "* (auth middleware)" },
  { key: "JWT_WEAK_HMAC_SECRET", class: "JWT weak key", cwe: "CWE-326", endpoint: "* (auth middleware)" },
  { key: "JWT_TRUST_KID", class: "JWT kid injection/traversal", cwe: "CWE-347", endpoint: "* (auth middleware)" },
  { key: "JWT_TRUST_JKU", class: "JWT jku SSRF+key injection", cwe: "CWE-347", endpoint: "* (auth middleware)" },
  { key: "JWT_SKIP_EXPIRY", class: "JWT expiry not checked", cwe: "CWE-613", endpoint: "* (auth middleware)" },
] as const;

export const DEMO = Object.freeze(
  Object.fromEntries(DEMO_FLAG_REGISTRY.map((f) => [f.key, on(f.key)]))
) as Readonly<Record<(typeof DEMO_FLAG_REGISTRY)[number]["key"], boolean>>;

export function enabledFlags(): FlagMeta[] {
  return DEMO_FLAG_REGISTRY.filter((f) => on(f.key));
}

export function assertDemoFlagsSafe(): void {
  const active = enabledFlags();
  if (active.length === 0) return;

  const demoModeAllowed =
    process.env.NODE_ENV !== "production" && process.env.DEMO_MODE === "true";

  if (!demoModeAllowed) {
    throw new Error(
      `[FATAL] ${active.length} demo flag(s) enabled but demo mode is not permitted ` +
        `(NODE_ENV=${process.env.NODE_ENV}, DEMO_MODE=${process.env.DEMO_MODE}). ` +
        `Enabled: ${active.map((f) => f.key).join(", ")}. Refusing to start.`
    );
  }

  if (active.length > 1) {
    // eslint-disable-next-line no-console
    console.warn(
      `[DEMO] WARNING: ${active.length} flags enabled at once — PoC attribution is ` +
        `ambiguous. Enable exactly one.`
    );
  }

  const banner = active
    .map((f) => `    - ${f.key}  [${f.class} / ${f.cwe} @ ${f.endpoint}]`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.warn(
    `\n${"!".repeat(72)}\n` +
      `  DEMO MODE ACTIVE — INSECURE BRANCHES ENABLED. NOT FOR PRODUCTION.\n` +
      `${banner}\n` +
      `${"!".repeat(72)}\n`
  );
}
