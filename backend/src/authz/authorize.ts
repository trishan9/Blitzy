import type { Request, Response, NextFunction, RequestHandler } from "express";
import { can, assertCan, type Actor, type Action, type Resource } from "./policy";

const IGNORED_OVERRIDE_HEADERS = [
  "x-original-url",
  "x-rewrite-url",
  "x-http-method-override",
  "x-method-override",
  "x-forwarded-host",
] as const;

export const stripOverrideHeaders: RequestHandler = (req, _res, next) => {
  for (const h of IGNORED_OVERRIDE_HEADERS) {
    if (h in req.headers) delete req.headers[h];
  }
  next();
};

export function allowMethods(...methods: string[]): RequestHandler {
  const allow = methods.map((m) => m.toUpperCase());
  const allowHeader = allow.join(", ");
  return (req: Request, res: Response, next: NextFunction) => {
    if (!allow.includes(req.method.toUpperCase())) {
      res.setHeader("Allow", allowHeader);
      res.status(405).json({ error: "method not allowed" });
      return;
    }
    next();
  };
}

export function getActor(req: Request): Actor {
  return (req as Request & { actor?: Actor }).actor ?? null;
}

export function requirePolicy(action: Action, resource: Resource): RequestHandler {
  return (req, _res, next) => {
    assertCan(getActor(req), action, resource);
    next();
  };
}

export const requireAdmin: RequestHandler = requirePolicy("admin:access", { kind: "adminPanel" });

export { can, assertCan };
export type { Actor, Action, Resource };
