export const getStatusColorClass = (status: string): string => {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case "delivered":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20";
    case "paid":
      return "bg-blue-500/10 text-blue-600 border-blue-500/20 hover:bg-blue-500/20";
    case "packed":
      return "bg-indigo-500/10 text-indigo-600 border-indigo-500/20 hover:bg-indigo-500/20";
    case "shipped":
      return "bg-sky-500/10 text-sky-600 border-sky-500/20 hover:bg-sky-500/20";
    case "cancelled":
      return "bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/20";
    case "refunded":
      return "bg-purple-500/10 text-purple-600 border-purple-500/20 hover:bg-purple-500/20";
    case "pending_payment":
    default:
      return "bg-amber-500/10 text-amber-600 border-amber-500/20 hover:bg-amber-500/20";
  }
};

export const formatStatusLabel = (status: string): string =>
  (status ?? "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
