import { createHmac } from "node:crypto";
import { timingSafeEqualStr } from "../security/crypto";

const COOKIE_NAME = "ecom_guest_cart";

function secret(): string {
  const s = process.env.GUEST_CART_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("GUEST_CART_SECRET/BETTER_AUTH_SECRET not set");
  return s;
}

function sign(guestCartId: string): string {
  return createHmac("sha256", `${secret()}:guest-cart`).update(guestCartId).digest("base64url");
}

export function makeGuestCartCookie(guestCartId: string): { name: string; value: string } {
  return { name: COOKIE_NAME, value: `${guestCartId}.${sign(guestCartId)}` };
}

export const guestCartCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7 * 1000,
};

export function verifyGuestCartCookie(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  if (!timingSafeEqualStr(mac, sign(id))) return null;
  return id;
}

export { COOKIE_NAME as GUEST_CART_COOKIE_NAME };
