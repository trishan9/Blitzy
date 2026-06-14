import type { Request, Response, NextFunction, RequestHandler } from "express";
import { securityEvent } from "../observability/logger";
import { eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth/auth";
import { verifyAccessToken, TokenInvalid } from "../auth/jwt-verify";
import { asSystem } from "../db/client";
import { users } from "../db/schema";
import type { Actor } from "../authz/policy";

declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
  }
}

async function confirmUser(sub: string, ver?: number): Promise<Actor> {
  return asSystem(async (tx) => {
    const rows = await tx
      .select({ id: users.id, role: users.role, banned: users.banned, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);
    const u = rows[0];
    if (!u || u.banned) {
      securityEvent("SESSION_REVOKED", { actor: sub, reason: u ? "banned" : "deleted" });
      return null;
    }
    if (ver !== undefined && ver !== u.tokenVersion) {
      securityEvent("SESSION_REVOKED", { actor: sub, reason: "token-version" });
      return null;
    }
    return { id: u.id, role: u.role === "ADMIN" ? "ADMIN" : "USER" };
  });
}

export const attachActor: RequestHandler = async (req, _res, next) => {
  try {
    const authz = req.headers.authorization;
    if (authz?.startsWith("Bearer ")) {
      const token = authz.slice("Bearer ".length).trim();
      try {
        const claims = await verifyAccessToken(token);
        req.actor = await confirmUser(claims.sub, claims.ver);
        return next();
      } catch (e) {
        if (e instanceof TokenInvalid) {
          securityEvent("JWT_VERIFY_FAILURE", {
            ip: req.ip,
            path: req.path,
            reason: e.message,

          });
          req.actor = null;
          return next();
        }
        throw e;
      }
    }

    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    req.actor = session?.user?.id ? await confirmUser(session.user.id) : null;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!req.actor) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  next();
};
