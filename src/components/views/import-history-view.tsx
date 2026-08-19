"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { History, FileSpreadsheet, AlertTriangle, CheckCircle2, Calendar } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ImportHistoryView() {
  const q = useQuery({ queryKey: ["import-history"], queryFn: api.importHistory });
  const [open, setOpen] = React.useState<any>(null);
  const items = q.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total Imports" value={items.length} icon={History} />
            <Stat label="Total Rows Imported" value={items.reduce((a, b) => a + b.validRows, 0)} icon={CheckCircle2} tone="emerald" />
            <Stat label="Total Invalid Rows" value={items.reduce((a, b) => a + b.invalidRows, 0)} icon={AlertTriangle} tone={items.some(i => i.invalidRows > 0) ? "amber" : "muted"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-primary" /> Import History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No imports yet. Go to Import Excel to upload your first file.
            </div>
          ) : (
            <div className="divide-y">
              {items.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setOpen(h)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 shrink-0">
                    <FileSpreadsheet className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{h.fileName}</span>
                      {h.sheetName && <Badge variant="outline" className="text-[10px]">{h.sheetName}</Badge>}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(h.importedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    <span className="text-muted-foreground">{h.totalRows.toLocaleString()} total</span>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300">
                      {h.validRows.toLocaleString()} valid
                    </Badge>
                    {h.invalidRows > 0 && (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300">
                        {h.invalidRows} invalid
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" /> Import Details
            </DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div><strong>File:</strong> {open.fileName}</div>
                <div><strong>Sheet:</strong> {open.sheetName}</div>
                <div><strong>Imported:</strong> {new Date(open.importedAt).toLocaleString()}</div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Mini label="Total" value={open.totalRows} />
                  <Mini label="Valid" value={open.validRows} tone="emerald" />
                  <Mini label="Invalid" value={open.invalidRows} tone={open.invalidRows > 0 ? "amber" : "muted"} />
                </div>
              </div>
              {open.errors?.length > 0 ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">
                    <AlertTriangle className="h-3.5 w-3.5" /> Error Report ({open.errors.length})
                  </div>
                  <div className="max-h-72 overflow-y-auto scroll-thin space-y-1">
                    {open.errors.map((e: any, i: number) => (
                      <div key={i} className="text-[11px] text-amber-800 dark:text-amber-200 border-b border-amber-500/10 pb-1">
                        <strong>Row {e.row}:</strong> {e.message}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 p-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> No errors — all rows imported successfully.
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, icon: Icon, tone = "muted" }: { label: string; value: number; icon: any; tone?: "muted" | "emerald" | "amber" }) {
  const tones = { muted: "text-foreground", emerald: "text-emerald-600", amber: "text-amber-600" };
  return (
    <div className="rounded-md border bg-card p-3">
      <Icon className={`h-4 w-4 mb-1 ${tones[tone]}`} />
      <div className={`text-xl font-bold tabular-nums ${tones[tone]}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
function Mini({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "emerald" | "amber" }) {
  const tones = { muted: "", emerald: "text-emerald-600", amber: "text-amber-600" };
  return (
    <div className="rounded bg-background p-2 text-center">
      <div className={`text-lg font-bold tabular-nums ${tones[tone]}`}>{value.toLocaleString()}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
