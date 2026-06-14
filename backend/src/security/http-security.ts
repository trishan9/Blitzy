import crypto from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import helmet from "helmet";
import { doubleCsrf } from "csrf-csrf";
import { DEMO } from "./demo-flags";

export function allowedOrigins(): Set<string> {
  return new Set(
    (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (origin === "null") return false;
  return allowedOrigins().has(origin);
}

export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;

  if (DEMO.REFLECT_CORS_ORIGIN && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  } else if (isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin!);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-CSRF-Token,Idempotency-Key"
    );
    res.setHeader("Access-Control-Max-Age", "600");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};

export const cspNonce: RequestHandler = (_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
};

export function securityHeaders(): RequestHandler {
  const reportOnly = process.env.CSP_REPORT_ONLY === "true";
  return helmet({
    contentSecurityPolicy: {
      reportOnly,
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": [
          (_req, res) => `'nonce-${(res as Response).locals.cspNonce}'`,
          "'strict-dynamic'",
        ],
        "style-src": ["'self'"],
        "img-src": ["'self'", "data:", "https:"],
        "connect-src": ["'self'"],
        "font-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "require-trusted-types-for": ["'script'"],
        "upgrade-insecure-requests": [],
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    noSniff: true,
    crossOriginResourcePolicy: { policy: "same-site" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    xPoweredBy: false,
  });
}

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.BETTER_AUTH_SECRET ?? "dev-secret",
  getSessionIdentifier: (req: Request) =>
    (req as Request & { actor?: { id: string } }).actor?.id ?? req.ip ?? "anon",
  cookieName: process.env.NODE_ENV === "production" ? "__Host-ecom.x-csrf" : "ecom.x-csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  size: 32,
  getCsrfTokenFromRequest: (req: Request) => req.headers["x-csrf-token"] as string | undefined,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});

export { generateCsrfToken };

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (DEMO.DISABLE_CSRF) return next();
  return doubleCsrfProtection(req, res, next);
};

export const originCheck: RequestHandler = (req, res, next) => {
  const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
  if (SAFE.has(req.method.toUpperCase())) return next();
  if (DEMO.DISABLE_CSRF) return next();

  const secFetchSite = req.headers["sec-fetch-site"] as string | undefined;

  if (secFetchSite === "cross-site") {
    res.status(403).json({ error: "cross-site request rejected" });
    return;
  }

  if (secFetchSite === "same-origin" || secFetchSite === "none") return next();

  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    res.status(403).json({ error: "cross-site request rejected" });
    return;
  }
  next();
};

export const rejectAmbiguousRequests: RequestHandler = (req, res, next) => {
  if (req.headers["content-length"] && req.headers["transfer-encoding"]) {
    res.status(400).json({ error: "ambiguous request framing" });
    return;
  }
  if (req.method === "TRACE" || req.method === "TRACK") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  next();
};
