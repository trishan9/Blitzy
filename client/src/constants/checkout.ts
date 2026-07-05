export const CheckoutPaymentMethod = {
  CARD: "CARD",
  ESEWA: "ESEWA",
  CASH_ON_DELIVERY: "CASH_ON_DELIVERY",
} as const;

export type CheckoutPaymentMethod =
  (typeof CheckoutPaymentMethod)[keyof typeof CheckoutPaymentMethod];

export type CheckoutAddress = {
  id: string;
  name: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};
