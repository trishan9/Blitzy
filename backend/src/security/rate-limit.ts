
import { RateLimiterRedis, type RateLimiterRes } from "rate-limiter-flexible";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Redis } from "ioredis";
import { DEMO } from "./demo-flags";
import { rateLimitTripped } from "../observability/metrics";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  enableOfflineQueue: false,
});

export const redisReady: Promise<void> = new Promise((resolve, reject) => {
  if (redis.status === "ready") return resolve();
  redis.once("ready", () => resolve());
  redis.once("error", (e) => reject(e));
});

export const apiLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:api",
  points: 300,
  duration: 60,
});

export const loginIpLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:login:ip",
  points: 10,
  duration: 300,
  blockDuration: 900,
});

export const loginAccountLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:login:acct",
  points: 5,
  duration: 900,
  blockDuration: 900,
});

export const aiLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: "rl:ai",
  points: 20,
  duration: 3600,
});

export interface LimitOutcome {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

async function consume(
  limiter: RateLimiterRedis,
  key: string,
  points = 1
): Promise<LimitOutcome> {
  try {
    const res = await limiter.consume(key, points);
    return { allowed: true, remaining: res.remainingPoints, retryAfterSeconds: 0 };
  } catch (e) {
    if (e && typeof e === "object" && "msBeforeNext" in e) {
      const r = e as RateLimiterRes;
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil(r.msBeforeNext / 1000) };
    }
    throw e;
  }
}

export async function consumeLoginAttempt(ip: string, email: string): Promise<LimitOutcome> {
  if (DEMO.DISABLE_LOCKOUT) {
    return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, retryAfterSeconds: 0 };
  }
  const acct = email.trim().toLowerCase();
  const [byIp, byAcct] = await Promise.all([
    consume(loginIpLimiter, ip),
    consume(loginAccountLimiter, acct),
  ]);
  if (!byIp.allowed || !byAcct.allowed) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(byIp.retryAfterSeconds, byAcct.retryAfterSeconds),
    };
  }
  return { allowed: true, remaining: Math.min(byIp.remaining, byAcct.remaining), retryAfterSeconds: 0 };
}

export async function resetLoginAttempts(ip: string, email: string): Promise<void> {
  await Promise.all([
    loginIpLimiter.delete(ip),
    loginAccountLimiter.delete(email.trim().toLowerCase()),
  ]);
}

export function rateLimit(limiter: RateLimiterRedis): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const outcome = await consume(limiter, req.ip ?? "unknown");
      res.setHeader("RateLimit-Remaining", String(outcome.remaining));
      if (!outcome.allowed) {
        rateLimitTripped.inc({ limiter: (limiter as { keyPrefix?: string }).keyPrefix ?? "api" });
        res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
        res.status(429).json({ error: "too many requests" });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function closeRateLimiter(): Promise<void> {
  await redis.quit();
}
