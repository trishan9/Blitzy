import express, { type Express, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { toNodeHandler } from "better-auth/node";

import { auth } from "./auth/auth";
import { httpLogger } from "./observability/logger";
import {
  corsMiddleware,
  securityHeaders,
  cspNonce,
  csrfProtection,
  originCheck,
  rejectAmbiguousRequests,
  generateCsrfToken,
} from "./security/http-security";
import { stripOverrideHeaders } from "./authz/authorize";
import { attachActor } from "./middlewares/auth.middleware";
import { rateLimit, apiLimiter } from "./security/rate-limit";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.middleware";
import { assertDemoFlagsSafe } from "./security/demo-flags";
import { metricsMiddleware, metricsHandler } from "./observability/metrics";
import stripeWebhookRouter from "./routes/secure/stripe-webhook.route";
import secureRoutes from "./routes/secure";

export function createApp(): Express {
  assertDemoFlagsSafe();

  const app = express();

  app.disable("x-powered-by");
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? "1");
  if (!Number.isInteger(hops) || hops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer");
  }
  app.set("trust proxy", hops);

  app.use(rejectAmbiguousRequests);

  app.use(httpLogger);
  app.use(metricsMiddleware);

  app.get("/metrics", metricsHandler);

  app.use("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), stripeWebhookRouter);

  app.use(cspNonce);
  app.use(securityHeaders());

  app.use(corsMiddleware);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));
  app.use(cookieParser());

  app.use(stripOverrideHeaders);

  app.all("/api/auth/*splat", toNodeHandler(auth));

  app.use(attachActor);

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "healthy" });
  });

  app.get("/api/csrf-token", (req: Request, res: Response) => {
    const body = JSON.stringify({ csrfToken: generateCsrfToken(req, res) });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.end(body);
  });

  app.use("/api", rateLimit(apiLimiter));
  app.use("/api", originCheck);
  app.use("/api", csrfProtection);

  app.use("/api", secureRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
