"use client";

import * as React from "react";
import { FileCog, ArrowRight, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { FIELDS } from "@/lib/fields";
import { detectField, normalizeHeader } from "@/lib/header-normalize";
import type { CanonicalField } from "@/lib/fields";

export function SettingsMappingView() {
  const [testHeader, setTestHeader] = React.useState("FactoryPO");
  const detected = detectField(testHeader) as CanonicalField | "";
  const detectedLabel = detected ? FIELDS.find((f) => f.key === detected)?.label : null;

  return (
    <div className="space-y-6">
      {/* Live header detection tester */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="h-4 w-4 text-primary" /> Header Normalization Tester
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Try typing any Excel header variant — the system normalizes it (lowercase, alphanumeric-only) and matches it
            to the canonical field via aliases.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={testHeader}
              onChange={(e) => setTestHeader(e.target.value)}
              className="max-w-xs h-10"
              placeholder="e.g. Factory_PO, qty 1, SIZE…"
            />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-2 py-1 text-xs">{normalizeHeader(testHeader) || "(empty)"}</code>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <Badge className="bg-primary/10 text-primary border-primary/20">
                {detectedLabel ?? "— no match —"}
              </Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Factory PO", "FactoryPO", "factory po", "FACTORY PO", "Q'ty 1", "Quantity", "SIZE", "Dead Line", "PO NO#"].map((ex) => (
              <button
                key={ex}
                onClick={() => setTestHeader(ex)}
                className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Field alias reference table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileCog className="h-4 w-4 text-primary" /> Column Mapping Reference
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">System Field</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Group</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">Recognized Aliases (normalized)</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((f) => (
                  <tr key={f.key} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{f.label}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={
                        f.group === "shared" ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300" :
                        f.group === "variable" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300" :
                        "bg-muted text-muted-foreground"
                      }>
                        {f.group}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {f.aliases.map((a) => (
                          <code key={a} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{a}</code>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
