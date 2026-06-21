import client from "prom-client";
import { securityEvent } from "./logger";
import type { Request, Response, RequestHandler } from "express";

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests by method, route, status",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const rateLimitTripped = new client.Counter({
  name: "rate_limit_tripped_total",
  help: "Rate-limit rejections",
  labelNames: ["limiter"] as const,
  registers: [registry],
});

export const authLoginFailure = new client.Counter({
  name: "auth_login_failure_total",
  help: "Failed login attempts",
  registers: [registry],
});

export const aiTokensSpent = new client.Counter({
  name: "ai_tokens_spent_total",
  help: "AI tokens consumed",
  labelNames: ["model"] as const,
  registers: [registry],
});

export const httpLatency = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Request latency",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3],
  registers: [registry],
});

const SIGN_IN_PATH = /\/auth\/(sign-in|callback)/;
const isFailedSignIn = (path: string, status: number): boolean =>
  SIGN_IN_PATH.test(path) && (status === 401 || status === 403 || status === 429);

export const metricsMiddleware: RequestHandler = (req, res, next) => {
  const end = httpLatency.startTimer();
  res.on("finish", () => {
    const route = (req.route?.path ?? req.baseUrl ?? req.path ?? "unknown").toString();
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    end(labels);
    if (req.method === "POST" && isFailedSignIn(req.originalUrl ?? req.path, res.statusCode)) {
      authLoginFailure.inc();
      securityEvent("AUTH_LOGIN_FAILURE", {
        ip: req.ip,
        status: res.statusCode,
        path: req.originalUrl ?? req.path,
      });
    }
  });
  next();
};

export const metricsHandler: RequestHandler = async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", registry.contentType);
  res.send(await registry.metrics());
};
