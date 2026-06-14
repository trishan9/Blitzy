import type { Request, Response, NextFunction } from "express";
import { securityEvent } from "../observability/logger";
import { logger, correlationId } from "../observability/logger";
import { DEMO } from "../security/demo-flags";

interface AppErrorLike {
  httpStatus: number;
  message: string;
  name: string;
  expose?: Record<string, unknown>;
}

function isAppError(e: unknown): e is AppErrorLike {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as AppErrorLike).httpStatus === "number" &&
    (e as AppErrorLike).httpStatus >= 400 &&
    (e as AppErrorLike).httpStatus < 600
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const nm = (err as { name?: string })?.name;
  const EVENT: Record<string, "AUTHZ_DENIED" | "SSRF_BLOCKED" | "UPLOAD_REJECTED" | "JWT_VERIFY_FAILURE"> = {
    AuthzDenied: "AUTHZ_DENIED",
    SsrfBlocked: "SSRF_BLOCKED",
    UploadRejected: "UPLOAD_REJECTED",
    TokenInvalid: "JWT_VERIFY_FAILURE",
  };
  if (nm && EVENT[nm]) {
    securityEvent(EVENT[nm], {
      actor: (req as { actor?: { id?: string } }).actor?.id ?? null,
      ip: req.ip,
      path: req.path,
      reason: (err as { reason?: string })?.reason,
    });
  }

  const cid = correlationId(req);

  logger.error(
    { err, correlationId: cid, path: req.path, method: req.method },
    "request failed"
  );

  if (res.headersSent) return;

  if (DEMO.VERBOSE_ERRORS) {
    res.status(500).json({
      error: (err as Error)?.message ?? "error",
      stack: (err as Error)?.stack,
      correlationId: cid,
    });
    return;
  }

  if ((err as { code?: string })?.code === "EBADCSRFTOKEN") {
    res.status(403).json({ error: "invalid csrf token", correlationId: cid });
    return;
  }

  const parserType = (err as { type?: string })?.type;
  if (parserType === "entity.too.large") {
    res.status(413).json({ error: "payload too large", correlationId: cid });
    return;
  }
  if (parserType === "entity.parse.failed") {
    res.status(400).json({ error: "malformed request body", correlationId: cid });
    return;
  }

  if (isAppError(err)) {
    res.status(err.httpStatus).json({
      error: err.message,
      ...(err.expose ?? {}),
      correlationId: cid,
    });
    return;
  }
  res.status(500).json({ error: "internal server error", correlationId: cid });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: "not found", correlationId: correlationId(req) });
}
