export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Readonly<Record<OrderStatus, ReadonlyArray<OrderStatus>>> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["PACKED", "CANCELLED", "REFUNDED"],
  PACKED: ["SHIPPED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  const allowed = TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

export function nextStatuses(from: OrderStatus): ReadonlyArray<OrderStatus> {
  return TRANSITIONS[from] ?? [];
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export class IllegalTransition extends Error {
  readonly httpStatus = 409;
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus
  ) {
    super(`illegal order transition ${from} → ${to}`);
    this.name = "IllegalTransition";
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransition(from, to);
}
