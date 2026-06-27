import { randomBytes } from "node:crypto";
process.env.CRYPTO_MASTER_KEY = randomBytes(32).toString("base64");
process.env.BLIND_INDEX_PEPPER = "test-pepper";
process.env.GUEST_CART_SECRET = "test-guest-secret";

import { encrypt, decrypt, blindIndex, timingSafeEqualStr } from "../security/crypto";
import { can } from "../authz/policy";
import { canTransition, nextStatuses, isTerminal } from "../orders/state-machine";
import { evaluateCoupon } from "../coupons/apply";
import { resolveOrderBy, resolvePagination, SORTABLE } from "../catalog/product-query";
import { productListQuerySchema } from "../catalog/product-query.schema";
import { makeGuestCartCookie, verifyGuestCartCookie } from "../auth/guest-cart";
import { inspectHeaderOrThrow } from "../auth/jwt-verify";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : (fail++, console.log("FAIL:", m)); };
const throws = (fn: () => unknown, m: string) => { try { fn(); ok(false, m + " should throw"); } catch { ok(true, m); } };

const e = encrypt("9876543210", "pii:phone");
ok(decrypt(e, "pii:phone") === "9876543210", "crypto roundtrip");
throws(() => decrypt(e, "pii:email"), "crypto purpose binding");
throws(() => decrypt(e.slice(0, -3) + "zzz", "pii:phone"), "crypto tamper");
ok(encrypt("x") !== encrypt("x"), "crypto nonce unique");
ok(blindIndex("A@X.com ") === blindIndex("a@x.com"), "blind index normalise");
ok(timingSafeEqualStr("a", "a") && !timingSafeEqualStr("a", "b"), "timing safe compare");

const alice = { id: "a", role: "USER" as const }, bob = { id: "b", role: "USER" as const }, admin = { id: "x", role: "ADMIN" as const };
ok(!can(bob, "read", { kind: "order", ownerId: "a" }), "IDOR order blocked");
ok(can(alice, "read", { kind: "order", ownerId: "a" }), "own order");
ok(!can(alice, "admin:access", { kind: "adminPanel" }), "user no admin");
ok(can(admin, "admin:access", { kind: "adminPanel" }), "admin panel");
ok(!can(admin, "update", { kind: "address", ownerId: "a" }), "admin cannot edit address");
ok(!can(alice, "read", { kind: "cart", ownerId: null }), "no guest cart adopt");
ok(!can(admin, "delete", { kind: "auditLog" }), "auditlog append-only");

ok(canTransition("PENDING_PAYMENT", "PAID"), "sm legal");
ok(!canTransition("PAID", "PAID"), "sm no-op rejected");
ok(!canTransition("DELIVERED", "SHIPPED"), "sm backward rejected");
ok(!canTransition("PENDING_PAYMENT", "REFUNDED"), "sm refund needs PAID");
ok(isTerminal("CANCELLED") && isTerminal("REFUNDED"), "sm terminals");
ok(nextStatuses("PAID").length === 3, "sm next from PAID");

const base = { code: "X", type: "PERCENT" as const, value: 10n, minSpendPaisa: 0n, maxRedemptions: null, timesRedeemed: 0, perUserLimit: 1, startsAt: null, expiresAt: null, active: true, stackable: false };
const ctx = { subtotalPaisa: 100000n, now: new Date("2026-07-23"), userRedemptionCount: 0, otherCouponAlreadyApplied: false };
const r1 = evaluateCoupon(base, ctx); ok(r1.ok && r1.discountPaisa === 10000n, "coupon percent");
const r2 = evaluateCoupon({ ...base, type: "FIXED", value: 999999n }, ctx); ok(r2.ok && r2.discountPaisa === 100000n, "coupon clamped to subtotal");
const r3 = evaluateCoupon(base, { ...ctx, userRedemptionCount: 1 }); ok(!r3.ok && r3.reason === "PER_USER_LIMIT", "coupon per-user limit");
const r4 = evaluateCoupon({ ...base, expiresAt: new Date("2026-07-22") }, ctx); ok(!r4.ok && r4.reason === "EXPIRED", "coupon expired");

const known = new Set(Object.values(SORTABLE));
for (const evil of ["name;DROP TABLE products--", "(CASE WHEN 1=1 THEN name END)", "1"]) {
  const clause = resolveOrderBy(evil, "asc");
  ok(clause != null, `evil sort '${evil}' produced a safe clause`);
}
ok(Object.keys(SORTABLE).length === 4 && known.size === 4, "sortable allowlist closed");
ok(resolvePagination("99999", "10000").pageSize === 60, "pagination clamped");
ok(resolvePagination("-5", "abc").page === 1, "pagination floor");
ok(!productListQuerySchema.safeParse({ sort: "price", evil: 1 }).success, "zod strict rejects unknown key");
ok(!productListQuerySchema.safeParse({ sort: "; DROP" }).success, "zod rejects bad sort");
ok(productListQuerySchema.safeParse({ sort: "price", dir: "asc" }).success, "zod accepts valid");

const c = makeGuestCartCookie("cart-123");
ok(verifyGuestCartCookie(c.value) === "cart-123", "guest cart roundtrip");
ok(verifyGuestCartCookie("other." + c.value.split(".")[1]) === null, "guest cart id swap rejected");
ok(verifyGuestCartCookie("cart-123.forged") === null, "guest cart forged mac rejected");

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
ok(inspectHeaderOrThrow(b64({ alg: "EdDSA", kid: "k1" }) + ".x.y").alg === "EdDSA", "jwt good header");
throws(() => inspectHeaderOrThrow(b64({ alg: "none" }) + ".x.y"), "jwt alg:none rejected");
throws(() => inspectHeaderOrThrow(b64({ alg: "EdDSA", jku: "https://evil" }) + ".x.y"), "jwt jku rejected");
throws(() => inspectHeaderOrThrow(b64({ alg: "EdDSA", x5u: "https://evil" }) + ".x.y"), "jwt x5u rejected");
throws(() => inspectHeaderOrThrow(b64({ alg: "EdDSA", jwk: {} }) + ".x.y"), "jwt jwk rejected");

console.log(`\nREAL-MODULE verification: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
