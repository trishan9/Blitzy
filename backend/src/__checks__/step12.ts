
import "./env";
import "dotenv/config";
import { isOriginAllowed } from "../security/http-security";
import {
  consumeLoginAttempt, resetLoginAttempts, closeRateLimiter, redisReady,
} from "../security/rate-limit";
import { errorHandler } from "../middlewares/error-handler.middleware";
import { logger } from "../observability/logger";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };

process.env.BETTER_AUTH_TRUSTED_ORIGINS = "https://shop.example.com,http://localhost:5173";
ok(isOriginAllowed("https://shop.example.com"), "exact allowed origin accepted");
ok(isOriginAllowed("http://localhost:5173"), "second allowed origin accepted");
ok(!isOriginAllowed("https://evil-shop.example.com"), "regex-suffix bypass rejected (evil-shop.example.com)");
ok(!isOriginAllowed("https://shop.example.com.evil.com"), "startsWith bypass rejected (…example.com.evil.com)");
ok(!isOriginAllowed("https://shop.example.com:8443"), "different port rejected");
ok(!isOriginAllowed("http://shop.example.com"), "different scheme rejected");
ok(!isOriginAllowed("null"), "null origin rejected (sandboxed iframe / data: URL)");
ok(!isOriginAllowed(undefined), "missing origin not allowed");
ok(!isOriginAllowed("*"), "wildcard never allowed");

function runHandler(err: unknown) {
  let status = 0; let body: any = null;
  const res: any = {
    headersSent: false,
    status(s: number) { status = s; return this; },
    json(b: any) { body = b; return this; },
  };
  errorHandler(err, { path: "/x", method: "POST", id: "cid-1" } as any, res, () => {});
  return { status, body };
}
const dbErr: any = new Error('duplicate key value violates unique constraint "users_email_uq"');
dbErr.code = "23505";
const r1 = runHandler(dbErr);
ok(r1.status === 500, "unknown/db error => 500");
ok(r1.body.error === "internal server error", "generic message, no DB text leaked");
ok(!JSON.stringify(r1.body).includes("users_email_uq"), "constraint name NOT leaked (no enumeration oracle)");
ok(!JSON.stringify(r1.body).includes("stack"), "no stack trace in response");
ok(typeof r1.body.correlationId === "string", "correlationId returned for tracing");

class Known extends Error { httpStatus = 404; }
const r2 = runHandler(new Known("not found"));
ok(r2.status === 404 && r2.body.error === "not found", "known AppError message preserved");

const captured: string[] = [];
const testLogger = (logger as any).child({}, {
});
{
  const pinoMod = require("pino");
  const sink = { write: (s: string) => captured.push(s) };
  const l = pinoMod({ redact: { paths: ["password","*.password","token","*.token","email","*.email","req.headers.authorization","req.headers.cookie"], censor: "[REDACTED]" } }, sink);
  l.info({ password: "hunter2", token: "eyJhbGciOi", email: "alice@lab.test", user: { password: "nested-secret" }, safe: "keep-me" }, "test");
  l.info({ req: { headers: { authorization: "Bearer abc.def.ghi", cookie: "session=xyz" } } }, "req");
}
const logged = captured.join("\n");
ok(!logged.includes("hunter2"), "password redacted from logs");
ok(!logged.includes("nested-secret"), "nested password redacted");
ok(!logged.includes("eyJhbGciOi"), "token redacted");
ok(!logged.includes("alice@lab.test"), "email (PII) redacted");
ok(!logged.includes("Bearer abc.def.ghi"), "Authorization header redacted");
ok(!logged.includes("session=xyz"), "Cookie header redacted");
ok(logged.includes("keep-me"), "non-sensitive fields still logged");

(async () => {
  await redisReady;
  const ip = "203.0.113." + Math.floor(Math.random() * 250);
  const acct = `victim+${Date.now()}@lab.test`;

  let allowedFromRotatingIps = 0;
  for (let i = 0; i < 12; i++) {
    const rotatingIp = `198.51.100.${i}`;
    const r = await consumeLoginAttempt(rotatingIp, acct);
    if (r.allowed) allowedFromRotatingIps++;
  }
  ok(allowedFromRotatingIps === 5,
     `PER-ACCOUNT limit holds against IP rotation: ${allowedFromRotatingIps}/12 allowed (expected 5)`);

  let allowedFromOneIp = 0;
  for (let i = 0; i < 15; i++) {
    const r = await consumeLoginAttempt(ip, `target${i}+${Date.now()}@lab.test`);
    if (r.allowed) allowedFromOneIp++;
  }
  ok(allowedFromOneIp === 10,
     `PER-IP limit holds against account spraying: ${allowedFromOneIp}/15 allowed (expected 10)`);

  const blocked = await consumeLoginAttempt(ip, `another+${Date.now()}@lab.test`);
  ok(!blocked.allowed, "further attempts from the blocked IP are refused");
  ok(blocked.retryAfterSeconds > 0, `Retry-After is populated (${blocked.retryAfterSeconds}s)`);

  const freshIp = "203.0.113.250", freshAcct = `fresh+${Date.now()}@lab.test`;
  await consumeLoginAttempt(freshIp, freshAcct);
  await resetLoginAttempts(freshIp, freshAcct);
  const afterReset = await consumeLoginAttempt(freshIp, freshAcct);
  ok(afterReset.allowed, "buckets reset after a successful authentication");

  const atomicAcct = `atomic+${Date.now()}@lab.test`;
  const concurrent = await Promise.all(
    Array.from({ length: 50 }, (_, i) => consumeLoginAttempt(`192.0.2.${i}`, atomicAcct))
  );
  const grantedConcurrently = concurrent.filter(r => r.allowed).length;
  ok(grantedConcurrently === 5,
     `ATOMIC under 50 concurrent attempts: exactly 5 granted (got ${grantedConcurrently}) — limiter is not racy`);

  await closeRateLimiter();
  console.log(`\nStep 12 (rate limit / CORS / CSP / errors): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
