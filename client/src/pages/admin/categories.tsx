import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getAdminCategoriesQueryFn, createCategoryMutationFn, updateCategoryMutationFn,
  deleteCategoryMutationFn, type AdminCategory,
} from "@/lib/api";

type FormState = { id?: string; name: string; description: string; imageUrl: string };
const EMPTY: FormState = { name: "", description: "", imageUrl: "" };

export default function AdminCategoriesPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState<AdminCategory | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-categories"],
    queryFn: getAdminCategoriesQueryFn,
  });
  const categories = data?.categories ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const saveMutation = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? updateCategoryMutationFn({
            id: f.id, name: f.name,
            description: f.description || undefined,
            imageUrl: f.imageUrl || undefined,
          })
        : createCategoryMutationFn({
            name: f.name,
            description: f.description || undefined,
            imageUrl: f.imageUrl || undefined,
          }),
    onSuccess: () => {
      toast.success(form.id ? "Category updated" : "Category created");
      setOpen(false); setForm(EMPTY); invalidate();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Could not save category"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCategoryMutationFn(id),
    onSuccess: () => { toast.success("Category deleted"); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? "Could not delete category"),
  });

  const openCreate = () => { setForm(EMPTY); setOpen(true); };
  const openEdit = (c: AdminCategory) => {
    setForm({ id: c._id, name: c.name, description: c.description, imageUrl: c.imageUrl });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Categories</h1>
          <p className="text-sm text-muted-foreground">{categories.length} categories</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> New category
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>All categories</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-center">Products</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))}

              {!isLoading && categories.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    No categories yet.
                  </TableCell>
                </TableRow>
              )}

              {categories.map((c) => (
                <TableRow key={c._id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      {c.imageUrl ? (
                        <img src={c.imageUrl} alt="" className="h-9 w-9 rounded object-cover" />
                      ) : (
                        <div className="h-9 w-9 rounded bg-muted" />
                      )}
                      {c.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell className="max-w-[280px] truncate text-muted-foreground">
                    {c.description || "—"}
                  </TableCell>
                  <TableCell className="text-center">{c.productCount}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={c.isActive ? "default" : "secondary"}>
                      {c.isActive ? "Active" : "Hidden"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)} aria-label="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" aria-label="Delete"
                      onClick={() => setConfirmDelete(c)}
                      disabled={c.productCount > 0}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit category" : "New category"}</DialogTitle>
            <DialogDescription>
              Categories group products in the storefront.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cat-name">Name</Label>
              <Input id="cat-name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Beverages" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-desc">Description</Label>
              <Textarea id="cat-desc" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Short description shown on the category card" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-img">Image URL</Label>
              <Input id="cat-img" value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder="https://…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={!form.name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : form.id ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              {confirmDelete && confirmDelete.productCount > 0
                ? `This category still has ${confirmDelete.productCount} product(s). The server will refuse the delete until they are moved.`
                : "This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete._id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
