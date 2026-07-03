export const formatPrice = (value: number) => {
  return `Rs. ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)}`;
};

export const CURRENCY = "Rs.";

export const itemPrice = (price: number, paisa = 0) => {
  return price + paisa / 100;
};

export type StockStatus = "in-stock" | "low" | "out";

export const getStockDisplay = ({
  stockCount,
}: {
  stockCount?: number;
}) => {
  if (stockCount === 0) {
    return { text: "Out of stock", status: "out" as const };
  }
  if (typeof stockCount === "number" && stockCount <= 5) {
    return { text: `Only ${stockCount} left`, status: "low" as const };
  }
  return { text: "Many in stock", status: "in-stock" as const };
};


export const splitPrice = (price: number) => {
  const [rupees, paisa = "00"] = price.toFixed(2).split(".");
  return { rupees: Number(rupees), paisa: Number(paisa) };
};
