import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ShieldBan, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { getAdminUsersQueryFn, banUserMutationFn, type AdminUser } from "@/lib/api";
import { useSession } from "@/hooks/use-session";

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const { user: me } = useSession();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [target, setTarget] = useState<AdminUser | null>(null);
  const limit = 10;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", page, keyword],
    queryFn: () => getAdminUsersQueryFn({ page, limit, keyword: keyword || undefined }),
  });
  const users = data?.users ?? [];
  const totalPages = data?.pagination?.totalPages ?? 1;

  const banMutation = useMutation({
    mutationFn: banUserMutationFn,
    onSuccess: (_d, vars) => {
      toast.success(vars.banned ? "User banned — active sessions revoked" : "User unbanned");
      setTarget(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Could not update user"),
  });

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setKeyword(search.trim());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            {data?.pagination?.total ?? 0} registered users
          </p>
        </div>
        <form onSubmit={submitSearch} className="flex gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="w-56"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <Search className="h-4 w-4" />
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader><CardTitle>All users</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-center">Role</TableHead>
                <TableHead className="text-center">Verified</TableHead>
                <TableHead className="text-center">Orders</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}

              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    No users found.
                  </TableCell>
                </TableRow>
              )}

              {users.map((u) => {
                const isMe = me?.id === u._id;
                return (
                  <TableRow key={u._id}>
                    <TableCell className="font-medium">
                      {u.name} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={u.role === "ADMIN" ? "default" : "secondary"}>{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {u.emailVerified ? "Yes" : <span className="text-muted-foreground">No</span>}
                    </TableCell>
                    <TableCell className="text-center">{u.orderCount}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={u.banned ? "destructive" : "secondary"}>
                        {u.banned ? "Banned" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {}
                      <Button
                        variant="ghost" size="sm" className="gap-1"
                        disabled={isMe}
                        onClick={() => setTarget(u)}
                      >
                        {u.banned
                          ? <><ShieldCheck className="h-4 w-4" /> Unban</>
                          : <><ShieldBan className="h-4 w-4 text-destructive" /> Ban</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <Pagination className="mt-4">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-3 text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target?.banned ? `Unban ${target?.name}?` : `Ban ${target?.name}?`}
            </DialogTitle>
            <DialogDescription>
              {target?.banned
                ? "They will be able to sign in again."
                : "They will be signed out immediately — banning revokes all active sessions, not just future logins."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              variant={target?.banned ? "default" : "destructive"}
              disabled={banMutation.isPending}
              onClick={() => target && banMutation.mutate({ id: target._id, banned: !target.banned })}
            >
              {banMutation.isPending ? "Working…" : target?.banned ? "Unban" : "Ban user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
