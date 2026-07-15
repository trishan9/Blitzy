import { formatPrice } from "@/utils/helper";
import { Fragment, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getStatusColorClass, formatStatusLabel } from "@/utils/status";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminOrdersResponse } from "@/types/order.type";
import { getAdminOrdersQueryFn, updateOrderStatusMutationFn, getAdminAnalyticsQueryFn } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Pending Payment",
  PAID: "Paid",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const NEXT_STATUSES: Record<string, string[]> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["PACKED", "CANCELLED", "REFUNDED"],
  PACKED: ["SHIPPED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "REFUNDED"],
  DELIVERED: ["REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

const FILTERS: Array<{ value: string | null; label: string }> = [
  { value: null, label: "All" },
  { value: "PENDING_PAYMENT", label: "Pending Payment" },
  { value: "PAID", label: "Paid" },
  { value: "PACKED", label: "Packed" },
  { value: "SHIPPED", label: "Shipped" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REFUNDED", label: "Refunded" },
];

export default function AdminOrdersPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [status, setStatus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setKeyword(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [status, keyword]);

  const { data: ordersData, isLoading } = useQuery<AdminOrdersResponse>({
    queryKey: ["admin-orders", page, limit, status, keyword],
    queryFn: () => getAdminOrdersQueryFn({ page, limit, status: status ?? undefined, keyword: keyword || undefined }),
  });

  const { data: analytics } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: getAdminAnalyticsQueryFn,
  });
  const counts: Record<string, number> = {};
  for (const row of (analytics?.ordersByStatus ?? []) as Array<{ status: string; n: number }>) {
    counts[row.status] = row.n;
  }
  const totalAll = Object.values(counts).reduce((a, b) => a + b, 0);

  const orders = ordersData?.orders || [];
  const pagination = ordersData?.pagination;
  const totalPages = pagination?.totalPages || 1;

  const updateStatusMutation = useMutation({
    mutationFn: updateOrderStatusMutationFn,
    onSuccess: (data) => {
      toast.success(data.message || "Order status updated successfully");
      queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
      queryClient.invalidateQueries({ queryKey: ["admin-analytics"] });
    },
    onError: (err: any) => {
      const errMsg = err.response?.data?.message || err.message || "Failed to update status";
      toast.error(errMsg);
    },
  });

  const handleStatusChange = (orderId: string, newStatus: string) => {
    updateStatusMutation.mutate({ orderId, status: newStatus });
  };

  if (isLoading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-1 h-4 w-56" />
        </div>
        <Card className="border-border">
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Array.from({ length: 8 }).map((_, i) => (
                      <TableHead key={i} className="px-6 py-2">
                        <Skeleton className="h-4 w-20" />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <TableCell key={j} className="px-6 py-4">
                          <Skeleton className="h-4 w-full max-w-28" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Orders</h2>
        <p className="text-muted-foreground">
          Manage and update customer orders status here.
        </p>
      </div>

      <Card className="border-border">
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              {status ? `${ORDER_STATUS_LABELS[status]} orders` : "All orders"} ({pagination?.total || 0})
            </CardTitle>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search order number"
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const n = f.value === null ? totalAll : (counts[f.value] ?? 0);
              const active = status === f.value;
              return (
                <Button
                  key={f.label}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setStatus(f.value)}
                  className="h-8"
                >
                  {f.label}
                  <span className={cn("ml-2 text-xs", active ? "opacity-80" : "text-muted-foreground")}>
                    {n}
                  </span>
                </Button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 px-2 py-2" />
                  <TableHead className="px-4 py-2">Order ID</TableHead>
                  <TableHead className="px-2 py-2">Customer</TableHead>
                  <TableHead className="px-2 py-2">Date</TableHead>
                  <TableHead className="px-2 py-2">Items</TableHead>
                  <TableHead className="px-2 py-2">Total</TableHead>
                  <TableHead className="px-2 py-2">Payment</TableHead>
                  <TableHead className="px-2 py-2">Status Update</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!orders || orders.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No orders found.
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((order: any) => (
                    <Fragment key={order._id}>
                    <TableRow className="hover:bg-muted/30 text-[13px]!">
                      <TableCell className="px-2 py-2">
                        <button
                          type="button"
                          aria-label={expanded === order._id ? "Hide details" : "Show details"}
                          onClick={() => setExpanded(expanded === order._id ? null : order._id)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                          {expanded === order._id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </TableCell>
                      <TableCell className="px-4 py-2 font-medium">
                        #{order.orderNo}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <div className="flex max-w-[220px] flex-col">
                          <span className="truncate font-medium">
                            {order.shippingAddress.recipientName}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {order.shippingAddress.phone}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {order.shippingAddress.city}, {order.shippingAddress.country}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-muted-foreground">
                        {new Date(order.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-sm max-w-[200px] truncate">
                        {order.items.length} Items
                      </TableCell>
                      <TableCell className="px-2 py-2 font-semibold">
                        {formatPrice(order.total)}
                      </TableCell>
                      <TableCell className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            order.paymentStatus === "PAID"
                              ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-500 border-amber-500/20",
                          )}
                        >
                          {formatStatusLabel(order.paymentStatus)}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-6 py-2">
                        <Select
                          disabled={
                            (NEXT_STATUSES[order.status]?.length ?? 0) === 0 ||
                            (updateStatusMutation.isPending &&
                              updateStatusMutation.variables?.orderId === order._id)
                          }
                          value={order.status}
                          onValueChange={(val) => handleStatusChange(order._id, val)}
                        >
                          <SelectTrigger
                            className={cn(
                              "h-9 w-[160px] font-medium capitalize",
                              getStatusColorClass(order.status),
                            )}
                          >
                            <SelectValue placeholder="Update status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={order.status}>
                              {ORDER_STATUS_LABELS[order.status] || order.status}
                            </SelectItem>
                            {(NEXT_STATUSES[order.status] ?? []).map((statusKey) => (
                              <SelectItem key={statusKey} value={statusKey}>
                                {ORDER_STATUS_LABELS[statusKey]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>

                    {expanded === order._id && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={8} className="px-6 py-5">
                          <div className="flex flex-col gap-6 lg:flex-row">
                            {/* what was bought */}
                            <div className="min-w-0 flex-1">
                              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Items
                              </h4>
                              <div className="flex flex-col gap-3">
                                {order.items.map((item: any, i: number) => (
                                  <div key={`${item.productId}-${i}`} className="flex items-center gap-3">
                                    {item.image ? (
                                      <img
                                        src={item.image}
                                        alt=""
                                        loading="lazy"
                                        className="size-10 shrink-0 rounded-md border border-border object-cover"
                                      />
                                    ) : (
                                      <div className="size-10 shrink-0 rounded-md border border-border bg-muted" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium">{item.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {item.quantity} x {formatPrice(item.salePrice)}
                                      </p>
                                    </div>
                                    <span className="text-sm font-medium">
                                      {formatPrice(item.salePrice * item.quantity)}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <h4 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Deliver to
                              </h4>
                              <p className="text-sm">{order.shippingAddress.recipientName}</p>
                              <p className="text-sm text-muted-foreground">{order.shippingAddress.phone}</p>
                              <p className="text-sm text-muted-foreground">
                                {order.shippingAddress.street}, {order.shippingAddress.city}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {order.shippingAddress.state} {order.shippingAddress.postalCode}, {order.shippingAddress.country}
                              </p>
                            </div>

                            {/* what it cost. Every figure comes from the order row, computed at
                                checkout from the database, never from anything the client sent. */}
                            <div className="w-full shrink-0 rounded-lg border border-border bg-background p-4 lg:w-72">
                              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Payment
                              </h4>
                              <dl className="flex flex-col gap-2 text-sm">
                                <div className="flex justify-between">
                                  <dt className="text-muted-foreground">Method</dt>
                                  <dd className="capitalize">{String(order.paymentMethod).replace(/_/g, " ").toLowerCase()}</dd>
                                </div>
                                <div className="flex justify-between">
                                  <dt className="text-muted-foreground">Subtotal</dt>
                                  <dd>{formatPrice(order.subtotal)}</dd>
                                </div>
                                {order.discount > 0 && (
                                  <div className="flex justify-between text-emerald-600">
                                    <dt>Discount</dt>
                                    <dd>-{formatPrice(order.discount)}</dd>
                                  </div>
                                )}
                                <div className="flex justify-between">
                                  <dt className="text-muted-foreground">Delivery</dt>
                                  <dd>{formatPrice(order.deliveryFee)}</dd>
                                </div>
                                <div className="flex justify-between">
                                  <dt className="text-muted-foreground">Tax</dt>
                                  <dd>{formatPrice(order.tax)}</dd>
                                </div>
                                <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                                  <dt>Total</dt>
                                  <dd>{formatPrice(order.total)}</dd>
                                </div>
                              </dl>
                              <p className="mt-3 text-xs text-muted-foreground">
                                Placed {new Date(order.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-4 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex-1 text-sm text-muted-foreground">
              Page {pagination?.page || 1} of {totalPages} ({pagination?.total || 0} orders)
            </p>
            <Pagination className="flex-1 justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (page > 1) setPage(page - 1);
                    }}
                    className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="flex h-9 w-9 items-center justify-center text-sm font-medium">
                    {page}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      if (page < totalPages) setPage(page + 1);
                    }}
                    className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
