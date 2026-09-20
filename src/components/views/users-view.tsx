"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users as UsersIcon, Plus, Trash2, ShieldCheck, Loader2, Save } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
  operator: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",
  viewer: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300",
};

const ROLE_PERMS: Record<string, string> = {
  admin: "Import, Export, Edit Master, Settings, Users, Data Entry, Delete",
  operator: "Data Entry, Search, Export, Edit own entries",
  viewer: "View, Search, Export (read-only)",
};

export function UsersView() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editRole, setEditRole] = React.useState("viewer");

  const users = q.data?.users ?? [];

  async function handleDelete(id: string, email: string) {
    if (!confirm(`Delete user ${email}?`)) return;
    try {
      await api.deleteUser(id);
      toast.success("User deleted");
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error("Delete failed", { description: e instanceof Error ? e.message : "" });
    }
  }

  async function saveRole() {
    if (!editId) return;
    try {
      await api.updateUser(editId, { role: editRole });
      toast.success("Role updated");
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      toast.error("Update failed");
    }
  }

  if (q.error) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Admin access required</p>
          <p className="mt-1 text-xs text-muted-foreground">
            You need an admin account to manage users. Sign in with an admin account.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UsersIcon className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">User Management</div>
            <div className="text-xs text-muted-foreground">
              Create accounts and assign roles. Role controls what each user can do.
            </div>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add User
          </Button>
        </CardContent>
      </Card>

      {/* Role legend */}
      <Card>
        <CardContent className="p-4">
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Role Permissions</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {Object.entries(ROLE_PERMS).map(([role, perms]) => (
              <div key={role} className="rounded-md border p-2.5">
                <Badge variant="outline" className={cn("text-[10px] mb-1", ROLE_COLORS[role])}>{role}</Badge>
                <p className="text-[11px] text-muted-foreground">{perms}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <UsersIcon className="h-4 w-4 text-primary" /> Users ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No users yet.</div>
          ) : (
            <div className="divide-y">
              {users.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                    {(u.name || u.email).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{u.name || u.email}</span>
                      <Badge variant="outline" className={cn("text-[10px]", ROLE_COLORS[u.role])}>{u.role}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8"
                      onClick={() => { setEditId(u.id); setEditRole(u.role); }}
                    >
                      Change role
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(u.id, u.email)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create user dialog */}
      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => qc.invalidateQueries({ queryKey: ["users"] })} />

      {/* Edit role dialog */}
      <Dialog open={!!editId} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">New role</Label>
            <Select value={editRole} onValueChange={setEditRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{ROLE_PERMS[editRole]}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
            <Button onClick={saveRole}><Save className="mr-1.5 h-4 w-4" /> Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("operator");
  const [loading, setLoading] = React.useState(false);

  async function submit() {
    if (!email || !password) return;
    setLoading(true);
    try {
      await api.createUser({ email, password, name, role });
      toast.success("User created");
      onCreated();
      onOpenChange(false);
      setEmail(""); setPassword(""); setName("");
    } catch (e) {
      toast.error("Create failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /> Add User</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="jane@smart-excel.local" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={loading || !email || !password}>
            {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
            Create User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
