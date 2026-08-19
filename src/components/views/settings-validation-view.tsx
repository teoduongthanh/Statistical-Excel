"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Calculator, Copy, AlertTriangle, Save, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { AppSettings } from "@/types";

export function SettingsValidationView() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [local, setLocal] = React.useState<AppSettings | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (q.data) setLocal(q.data);
  }, [q.data]);

  async function save() {
    if (!local) return;
    setSaving(true);
    try {
      await api.saveSettings(local);
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!local) return <div className="h-40 animate-pulse rounded-md bg-muted" />;

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-primary" /> Validation &amp; Behavior
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <ToggleRow
            icon={Calculator}
            title="Automatically calculate Qty 2"
            description="When enabled, Qty 2 is computed as Qty 1 × -1 (negated absolute value) and the field is locked from manual input."
            checked={local.autoCalcQty2}
            onCheckedChange={(v) => setLocal({ ...local, autoCalcQty2: v })}
          />
          <ToggleRow
            icon={Copy}
            title="Duplicate detection"
            description="Warn when adding a Factory PO + Size combination that already exists in entries, with options to update, cancel, or create a duplicate."
            checked={local.duplicateDetection}
            onCheckedChange={(v) => setLocal({ ...local, duplicateDetection: v })}
          />
          <ToggleRow
            icon={AlertTriangle}
            title="Allow negative Qty 1"
            description="Permit negative values in the Qty 1 input (e.g. for returns/adjustments). When off, negative inputs are blocked."
            checked={local.allowNegativeQty1}
            onCheckedChange={(v) => setLocal({ ...local, allowNegativeQty1: v })}
          />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  icon: any;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 border-b last:border-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5 max-w-md">{description}</div>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="mt-1" />
    </div>
  );
}
