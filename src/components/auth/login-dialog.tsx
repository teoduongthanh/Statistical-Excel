"use client";

import * as React from "react";
import { Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function LoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { signIn } = useAuth();
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      if (mode === "register") {
        await api.registerUser({ email, password, name, role: "admin" });
        toast.success("Admin account created. Logging you in…");
      }
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        toast.error("Login failed", { description: "Invalid email or password" });
      } else {
        toast.success("Logged in", { description: email });
        onOpenChange(false);
        setEmail(""); setPassword(""); setName("");
      }
    } catch (e) {
      toast.error(mode === "register" ? "Registration failed" : "Login failed", {
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {mode === "login" ? "Sign In" : "Create Admin Account"}
          </DialogTitle>
          <DialogDescription>
            {mode === "login"
              ? "Authenticate to access write operations (import, edit, delete)."
              : "Bootstrap the first admin account. After this, login is required for writes."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {mode === "register" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Admin User" className="h-10" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="admin@smart-excel.local" className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Password</Label>
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" className="h-10" />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto text-xs"
              onClick={() => setMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? (
                <><UserPlus className="mr-1.5 h-3.5 w-3.5" /> Create admin account</>
              ) : (
                <><LogIn className="mr-1.5 h-3.5 w-3.5" /> Back to login</>
              )}
            </Button>
            <Button type="submit" disabled={loading || !email || !password}>
              {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogIn className="mr-1.5 h-4 w-4" />}
              {mode === "login" ? "Sign In" : "Create & Sign In"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
