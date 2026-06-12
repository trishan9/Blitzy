import * as jose from "jose";
import { DEMO } from "../security/demo-flags";

export interface VerifiedActor {
  sub: string;
  role: "USER" | "ADMIN";
  jti: string;
  ver?: number;
}

export class TokenInvalid extends Error {
  readonly httpStatus = 401;
  constructor(reason: string) {
    super(reason);
    this.name = "TokenInvalid";
  }
}

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function localJWKS() {
  if (!jwks) {
    const base = process.env.APP_URL;
    if (!base) throw new Error("APP_URL is not set");
    jwks = jose.createRemoteJWKSet(new URL("/api/auth/jwks", base), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }
  return jwks;
}

export function inspectHeaderOrThrow(token: string): { alg: string; kid?: string } {
  const dot = token.indexOf(".");
  if (dot <= 0) throw new TokenInvalid("malformed token");
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8"));
  } catch {
    throw new TokenInvalid("unparseable header");
  }
  const alg = String(header.alg ?? "");
  const kid = header.kid != null ? String(header.kid) : undefined;

  if (alg.toLowerCase() === "none") throw new TokenInvalid("alg:none rejected");
  if ("jku" in header || "x5u" in header || "jwk" in header || "x5c" in header) {
    throw new TokenInvalid("token-supplied key header rejected");
  }
  return { alg, kid };
}

export async function verifyAccessToken(token: string): Promise<VerifiedActor> {
  if (DEMO.USE_NAIVE_JWT_VERIFIER) return naiveVerifyForDemo(token);

  inspectHeaderOrThrow(token);

  let payload: jose.JWTPayload & { role?: string; ver?: number };
  try {
    const result = await jose.jwtVerify(token, localJWKS(), {
      algorithms: ["EdDSA"],
      issuer: process.env.JWT_ISS,
      audience: process.env.JWT_AUD,
      clockTolerance: 5,
      requiredClaims: ["sub", "exp", "iat", "nbf", "jti"],
    });
    payload = result.payload as typeof payload;
  } catch (e) {
    throw new TokenInvalid((e as Error).message);
  }

  const role = payload.role === "ADMIN" ? "ADMIN" : "USER";
  return { sub: String(payload.sub), role, jti: String(payload.jti), ver: payload.ver };
}

async function naiveVerifyForDemo(token: string): Promise<VerifiedActor> {
  if (!DEMO.USE_NAIVE_JWT_VERIFIER) {
    throw new Error("naive verifier is demo-only");
  }
  const [h, p] = token.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));

  if (DEMO.JWT_ACCEPT_ALG_NONE && String(header.alg).toLowerCase() === "none") {
    return asActor(payload);
  }
  if (DEMO.JWT_SKIP_VERIFY) {
    return asActor(payload);
  }
  if (DEMO.JWT_ALLOW_HS256 || DEMO.JWT_WEAK_HMAC_SECRET) {
    return asActor(payload);
  }
  if (DEMO.JWT_TRUST_KID || DEMO.JWT_TRUST_JKU) {
    return asActor(payload);
  }
  if (DEMO.JWT_SKIP_EXPIRY) {
    return asActor(payload);
  }
  return asActor(payload);
}

function asActor(payload: Record<string, unknown>): VerifiedActor {
  return {
    sub: String(payload.sub ?? ""),
    role: payload.role === "ADMIN" ? "ADMIN" : "USER",
    jti: String(payload.jti ?? ""),
    ver: typeof payload.ver === "number" ? payload.ver : undefined,
  };
}
