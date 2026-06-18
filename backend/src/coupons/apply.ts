export type CouponType = "PERCENT" | "FIXED";

export interface CouponInput {
  code: string;
  type: CouponType;
  value: bigint;
  minSpendPaisa: bigint;
  maxRedemptions: number | null;
  timesRedeemed: number;
  perUserLimit: number;
  startsAt: Date | null;
  expiresAt: Date | null;
  active: boolean;
  stackable: boolean;
}

export interface ApplyContext {
  subtotalPaisa: bigint;
  now: Date;
  userRedemptionCount: number;
  otherCouponAlreadyApplied: boolean;
}

export type ApplyResult =
  | { ok: true; discountPaisa: bigint }
  | { ok: false; reason: ApplyDenyReason };

export type ApplyDenyReason =
  | "INACTIVE"
  | "NOT_STARTED"
  | "EXPIRED"
  | "MIN_SPEND"
  | "MAX_REDEMPTIONS"
  | "PER_USER_LIMIT"
  | "NOT_STACKABLE"
  | "NO_DISCOUNT";

export function evaluateCoupon(coupon: CouponInput, ctx: ApplyContext): ApplyResult {
  if (!coupon.active) return deny("INACTIVE");

  if (coupon.startsAt && ctx.now < coupon.startsAt) return deny("NOT_STARTED");
  if (coupon.expiresAt && ctx.now >= coupon.expiresAt) return deny("EXPIRED");

  if (ctx.subtotalPaisa < coupon.minSpendPaisa) return deny("MIN_SPEND");

  if (coupon.maxRedemptions !== null && coupon.timesRedeemed >= coupon.maxRedemptions) {
    return deny("MAX_REDEMPTIONS");
  }
  if (ctx.userRedemptionCount >= coupon.perUserLimit) return deny("PER_USER_LIMIT");

  if (ctx.otherCouponAlreadyApplied && !coupon.stackable) return deny("NOT_STACKABLE");

  const raw = rawDiscount(coupon, ctx.subtotalPaisa);
  const discountPaisa = clamp(raw, 0n, ctx.subtotalPaisa);
  if (discountPaisa <= 0n) return deny("NO_DISCOUNT");

  return { ok: true, discountPaisa };
}

function rawDiscount(coupon: CouponInput, subtotalPaisa: bigint): bigint {
  if (coupon.type === "FIXED") return coupon.value;
  return (subtotalPaisa * coupon.value) / 100n;
}

function clamp(v: bigint, min: bigint, max: bigint): bigint {
  return v < min ? min : v > max ? max : v;
}

function deny(reason: ApplyDenyReason): ApplyResult {
  return { ok: false, reason };
}
