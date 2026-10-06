"use client";

// ProductManagementView
// Dynamic product registration — add/edit/delete products without code changes.
// Each product gets its own:
//   - URL route: /dashboard/[slug]
//   - Data isolation (productType field in MasterData/EntryData)
//   - Theme color (from 10 presets)
//   - Feature set (all existing features: Dashboard, Data Entry, Master Data, etc.)
//
// Spec: user wants to freely add new product types like MAFATE, ONYX, MIZUNO,
// or any new brand (e.g., Adidas, Nike) without touching code.

import * as React from "react";
import {
  Package, Plus, Loader2, Trash2, Pencil, Check, X, PackageOpen,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { COLOR_PRESETS, themeFromColor } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const COLOR_OPTIONS = Object.keys(COLOR_PRESETS);

export function ProductManagementView() {
  const [products, setProducts] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [editProduct, setEditProduct] = React.useState<any>(null);
  const [deleteProduct, setDeleteProduct] = React.useState<any>(null);

  // Create form state
  const [form, setForm] = React.useState({
    productType: "", label: "", slug: "", description: "", color: "blue",
  });
  const [creating, setCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  async function loadProducts() {
    setLoading(true);
    try {
      const r = await api.listProducts();
      setProducts(r.products || []);
    } catch (e: any) {
      toast.error("Failed to load products", { description: e?.message });
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadProducts(); }, []);

  async function handleCreate() {
    if (!form.productType || !form.label || !form.slug) {
      toast.error("Product Type, Label, and Slug are required");
      return;
    }
    setCreating(true);
    try {
      await api.createProduct(form);
      toast.success(`Product "${form.label}" created successfully`, {
        description: `Route: /dashboard/${form.slug} · Color: ${form.color}`,
      });
      setShowCreate(false);
      setForm({ productType: "", label: "", slug: "", description: "", color: "blue" });
      await loadProducts();
    } catch (e: any) {
      toast.error("Create failed", { description: e?.message });
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit() {
    if (!editProduct) return;
    setSaving(true);
    try {
      await api.updateProduct(editProduct.id, {
        label: editProduct.label,
        slug: editProduct.slug,
        description: editProduct.description,
        color: editProduct.color,
      });
      toast.success(`Product "${editProduct.label}" updated`);
      setEditProduct(null);
      await loadProducts();
    } catch (e: any) {
      toast.error("Update failed", { description: e?.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteProduct) return;
    try {
      await api.deleteProduct(deleteProduct.id);
      toast.success(`Product "${deleteProduct.label}" deactivated`, {
        description: "Data preserved in DB. Reactivate anytime.",
      });
      setDeleteProduct(null);
      await loadProducts();
    } catch (e: any) {
      toast.error("Delete failed", { description: e?.message });
    }
  }

  // Auto-generate slug from label
  function autoSlug(label: string) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" /> Product Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Register new product types dynamically. Each product gets its own URL route,
            data isolation, theme color, and full feature set.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add Product
        </Button>
      </div>

      {/* Info card */}
      <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3 text-xs">
            <PackageOpen className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium text-blue-700 dark:text-blue-300">
                How dynamic products work
              </div>
              <div className="text-muted-foreground space-y-0.5">
                <div>• Each product creates a URL route: <code className="px-1 bg-muted rounded">/dashboard/[slug]</code></div>
                <div>• Data is isolated by <code className="px-1 bg-muted rounded">productType</code> field in MasterData/EntryData</div>
                <div>• All features (Dashboard, Data Entry, Master Data, Import, Export, etc.) are available for every product</div>
                <div>• Choose a color theme — auto-generates Tailwind classes for sidebar, badges, banners</div>
                <div>• Delete = soft delete (data preserved, product hidden from sidebar)</div>
                <div>• To add data: use <b>Import Excel</b> in the product's section after creating it</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Product list */}
      {loading ? (
        <div className="py-12 text-center">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No products found. Click "Add Product" to create your first product.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => {
            const theme = themeFromColor(p.color || "blue", p.label);
            return (
              <Card key={p.id} className="overflow-hidden">
                <div className={cn("h-2 bg-gradient-to-r", theme.gradient)} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span className={cn("h-3 w-3 rounded-full", theme.bg)} />
                      {p.label}
                    </CardTitle>
                    <Badge variant="secondary" className="text-[10px]">{p.sortOrder}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-1">
                    <div><span className="text-muted-foreground">Type:</span> <code className="font-mono">{p.productType}</code></div>
                    <div><span className="text-muted-foreground">Slug:</span> <code className="font-mono">{p.slug}</code></div>
                    <div><span className="text-muted-foreground">Color:</span> {p.color}</div>
                    <div><span className="text-muted-foreground">Status:</span> {p.active ? "✅ Active" : "❌ Inactive"}</div>
                  </div>
                  {p.description && (
                    <div className="text-muted-foreground italic">{p.description}</div>
                  )}
                  <div className="flex gap-1 pt-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditProduct({ ...p })}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setDeleteProduct(p)}>
                      <Trash2 className="h-3 w-3 mr-1" /> Deactivate
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add New Product</DialogTitle>
            <DialogDescription>
              Register a new product type. After creation, it appears in the sidebar
              and gets its own URL route + data isolation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Product Type (UPPERCASE) *</Label>
                <Input
                  value={form.productType}
                  onChange={(e) => setForm({ ...form, productType: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "") })}
                  placeholder="e.g., ADIDAS"
                  className="h-9 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">Used in DB as productType field. Uppercase, no spaces.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label (Display Name) *</Label>
                <Input
                  value={form.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setForm({ ...form, label, slug: autoSlug(label) });
                  }}
                  placeholder="e.g., Adidas"
                  className="h-9 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Slug (URL segment) *</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                  placeholder="e.g., adidas"
                  className="h-9 font-mono text-xs"
                />
                <p className="text-[10px] text-muted-foreground">URL: /dashboard/{form.slug || "..."}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Color Theme</Label>
                <Select value={form.color} onValueChange={(v) => setForm({ ...form, color: v })}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map((c) => {
                      const preset = COLOR_PRESETS[c];
                      return (
                        <SelectItem key={c} value={c}>
                          <span className="flex items-center gap-2">
                            <span className={cn("h-3 w-3 rounded-full", preset.bg)} />
                            {c}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description (optional)</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g., Adidas production line — shoes and apparel"
                className="text-xs"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || !form.productType || !form.label || !form.slug}>
              {creating ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Create Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editProduct} onOpenChange={(o) => !o && setEditProduct(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Edit Product</DialogTitle>
            <DialogDescription>Update product settings. ProductType cannot be changed.</DialogDescription>
          </DialogHeader>
          {editProduct && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Product Type (locked)</Label>
                  <Input value={editProduct.productType} disabled className="h-9 font-mono text-xs bg-muted" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input
                    value={editProduct.label}
                    onChange={(e) => setEditProduct({ ...editProduct, label: e.target.value })}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Slug</Label>
                  <Input
                    value={editProduct.slug}
                    onChange={(e) => setEditProduct({ ...editProduct, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                    className="h-9 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Color Theme</Label>
                  <Select value={editProduct.color} onValueChange={(v) => setEditProduct({ ...editProduct, color: v })}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COLOR_OPTIONS.map((c) => {
                        const preset = COLOR_PRESETS[c];
                        return (
                          <SelectItem key={c} value={c}>
                            <span className="flex items-center gap-2">
                              <span className={cn("h-3 w-3 rounded-full", preset.bg)} />
                              {c}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={editProduct.description || ""}
                  onChange={(e) => setEditProduct({ ...editProduct, description: e.target.value })}
                  className="text-xs"
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProduct(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Check className="h-4 w-4 mr-1.5" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteProduct} onOpenChange={(o) => !o && setDeleteProduct(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate "{deleteProduct?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The product will be hidden from the sidebar and its URL route will 404.
              Data in MasterData/EntryData is preserved and can be reactivated anytime.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
