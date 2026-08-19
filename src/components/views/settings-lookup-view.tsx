"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Trash2, Save, Loader2, KeyRound, Workflow } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FIELDS, SHARED_FIELDS, type CanonicalField } from "@/lib/fields";
import { toast } from "sonner";
import type { LookupRuleConfig } from "@/types";

const KEY_FIELDS = FIELDS.filter((f) => f.searchable).map((f) => ({ value: f.key, label: f.label }));

export function SettingsLookupView() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["lookup-rules"], queryFn: api.listLookupRules });
  const [draft, setDraft] = React.useState<LookupRuleConfig | null>(null);

  const rules = q.data ?? [];

  function startNew() {
    setDraft({
      name: "",
      primaryKey: "factoryPO",
      secondaryKey: "size",
      lookupFields: [...SHARED_FIELDS],
      autoCalcQty2: true,
      active: true,
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error("Name required"); return; }
    try {
      await api.saveLookupRule(draft as any);
      toast.success("Lookup rule saved");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["lookup-rules"] });
    } catch (e) {
      toast.error("Save failed");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this lookup rule?")) return;
    await api.deleteLookupRule(id);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["lookup-rules"] });
  }

  function toggleLookup(field: CanonicalField) {
    setDraft((d) => {
      if (!d) return d;
      const has = d.lookupFields.includes(field);
      return { ...d, lookupFields: has ? d.lookupFields.filter((f) => f !== field) : [...d.lookupFields, field] };
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Workflow className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium">Lookup Rules</div>
            <div className="text-xs text-muted-foreground">
              Configure which input fields trigger auto-fill, and which Master Data fields get filled.
            </div>
          </div>
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1.5 h-4 w-4" /> New Rule
          </Button>
        </CardContent>
      </Card>

      {/* Existing rules */}
      <div className="space-y-3">
        {q.isLoading ? (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        ) : rules.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No lookup rules.</CardContent></Card>
        ) : (
          rules.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{r.name}</span>
                      {r.active ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300">active</Badge>
                      ) : (
                        <Badge variant="outline">inactive</Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Primary:</span>
                      <code className="rounded bg-muted px-1.5 py-0.5">{r.primaryKey}</code>
                      {r.secondaryKey && (
                        <>
                          <span className="font-medium text-foreground ml-2">Secondary:</span>
                          <code className="rounded bg-muted px-1.5 py-0.5">{r.secondaryKey}</code>
                        </>
                      )}
                      <span className="font-medium text-foreground ml-2">Auto-fills:</span>
                      {r.lookupFields.map((f) => (
                        <Badge key={f} variant="outline" className="text-[10px] py-0">{f}</Badge>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <Badge variant={r.autoCalcQty2 ? "default" : "outline"} className="text-[10px]">
                        Qty2 auto-calc: {r.autoCalcQty2 ? "on" : "off"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDraft({ ...r })}>
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => remove(r.id!)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Draft editor */}
      {draft && (
        <Card className="border-primary/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{draft.id ? "Edit Rule" : "New Lookup Rule"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Rule Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Default Factory PO lookup" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Primary Key (input field)</Label>
                <Select value={draft.primaryKey} onValueChange={(v) => setDraft({ ...draft, primaryKey: v as CanonicalField })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {KEY_FIELDS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Secondary Key (optional)</Label>
                <Select value={draft.secondaryKey ?? ""} onValueChange={(v) => setDraft({ ...draft, secondaryKey: v as CanonicalField })}>
                  <SelectTrigger><SelectValue placeholder="— none —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {KEY_FIELDS.filter((f) => f.value !== draft.primaryKey).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Auto-fill Fields (from Master Data)</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SHARED_FIELDS.map((f) => {
                  const label = FIELDS.find((x) => x.key === f)?.label ?? f;
                  return (
                    <label key={f} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/40">
                      <Checkbox checked={draft.lookupFields.includes(f)} onCheckedChange={() => toggleLookup(f)} />
                      {label}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.autoCalcQty2} onCheckedChange={(v) => setDraft({ ...draft, autoCalcQty2: v })} />
                Auto-calculate Qty 2
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.active} onCheckedChange={(v) => setDraft({ ...draft, active: v })} />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save}><Save className="mr-1.5 h-4 w-4" /> Save Rule</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
