import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "node:crypto";
import type { Request, Response, RequestHandler } from "express";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-csrf-token']",
  "res.headers['set-cookie']",
  "password",
  "*.password",
  "*.passwordHash",
  "*.token",
  "token",
  "jwt",
  "*.jwt",
  "secret",
  "*.secret",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "*.backupCodes",
  "*.privateKey",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  base: { service: "ecommerce-api" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers["x-request-id"];
    const id =
      typeof incoming === "string" && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

export function correlationId(req: Request): string {
  return String((req as Request & { id?: string }).id ?? "unknown");
}

export type AuditAction =
  | "AUTH_LOGIN_SUCCESS" | "AUTH_LOGIN_FAILURE" | "AUTH_LOGOUT"
  | "AUTHZ_DENIED" | "ROLE_CHANGED" | "CREDENTIAL_CHANGED"
  | "ORDER_CREATED" | "ORDER_STATUS_CHANGED" | "PAYMENT_STATE_CHANGED"
  | "COUPON_REDEEMED" | "UPLOAD_ACCEPTED" | "UPLOAD_REJECTED"
  | "RATE_LIMIT_TRIPPED" | "VALIDATION_REJECTED" | "ADMIN_ACTION"
  | "SESSION_REVOKED" | "JWT_VERIFY_FAILURE" | "PROMPT_INJECTION_DETECTED"
  | "CANARY_LEAKED" | "SSRF_BLOCKED";

export function securityEvent(
  action: AuditAction,
  detail: {
    actor?: string | null;
    correlationId?: string;
    ip?: string;
    status?: number;
    reason?: string;
    path?: string;
  } = {}
): void {
  logger.warn({ sec_event: action, ...detail }, "security event");
}

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(
  exec: { execute: (q: any) => Promise<unknown> },
  sqlTag: (strings: TemplateStringsArray, ...values: unknown[]) => any,
  uuid: () => string,
  entry: AuditEntry
): Promise<void> {
  await exec.execute(sqlTag`
    INSERT INTO audit_log (id, actor_user_id, action, resource_type, resource_id, correlation_id, ip, metadata)
    VALUES (${uuid()}, ${entry.actorUserId ?? null}, ${entry.action},
            ${entry.resourceType ?? null}, ${entry.resourceId ?? null},
            ${entry.correlationId ?? null}, ${entry.ip ?? null},
            ${JSON.stringify(entry.metadata ?? {})}::jsonb)
  `);
  logger.info(
    {
      sec_event: entry.action,
      actor: entry.actorUserId,
      resource: entry.resourceId,
      correlationId: entry.correlationId,
      ip: entry.ip,
    },
    "audit"
  );
}
