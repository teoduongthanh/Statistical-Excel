"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, AlertTriangle, CheckCircle2, Loader2, X, ChevronDown,
  Clock, Zap, Database, Activity, AlertCircle, History,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAppStore, PRODUCT_THEME } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";

// Sync banner — shows below the header when there are pending changes.
// Polls /api/sync/pending every 15 seconds (debounced) so the banner appears
// soon after any data change. When the user clicks "Sync Now", it opens a
// dialog showing the affected modules + a confirm button that calls /api/sync/run.
export function SyncBanner() {
  const { currentProduct, refreshKey, bumpRefresh } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];
  const qc = useQueryClient();

  const [showSyncDialog, setShowSyncDialog] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [syncResult, setSyncResult] = React.useState<any>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  // Poll for pending sync status (scoped to current product).
  const pendingQ = useQuery({
    queryKey: ["sync-pending", currentProduct, refreshKey],
    queryFn: () => api.getPendingSync(currentProduct),
    refetchInterval: 15000, // poll every 15s
    refetchOnWindowFocus: true,
  });

  const pendingCount = pendingQ.data?.pendingCount ?? 0;
  const byAction = pendingQ.data?.byAction ?? {};
  const byEntity = pendingQ.data?.byEntity ?? {};
  const lastSyncedAt = pendingQ.data?.lastSyncedAt;
  const affectedKeys = pendingQ.data?.affectedProductKeys ?? [];

  const isSyncRequired = pendingCount > 0 && !dismissed;

  // Sync history query (lazy — only when history dialog opens).
  const historyQ = useQuery({
    queryKey: ["sync-history", refreshKey],
    queryFn: () => api.getSyncHistory(10),
    enabled: showHistory,
  });

  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.runSync({ productType: currentProduct, triggeredBy: "manual" });
      setSyncResult(result);
      if (result.ok) {
        toast.success(
          `Sync completed — ${result.eventsProcessed} events processed, ${result.productGroupsRecalculated} groups recalculated (${result.durationMs}ms)`
        );
        // Trigger all views to refetch (refreshKey bump + invalidate sync queries).
        bumpRefresh();
        qc.invalidateQueries({ queryKey: ["sync-pending"] });
        setDismissed(false);
      } else {
        toast.error("Sync failed", { description: "Sync run failed" });
      }
    } catch (e) {
      toast.error("Sync failed", { description: e instanceof Error ? e.message : "" });
    } finally {
      setSyncing(false);
    }
  }

  // ===== Hidden when no pending changes =====
  if (!isSyncRequired && !syncResult) return null;

  return (
    <>
      {/* ===== Sync Required Banner ===== */}
      {isSyncRequired && !syncResult && (
        <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-4 py-2">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold text-amber-800 dark:text-amber-200">
                ⚠ DATA HAS CHANGED
              </span>
              <span className="text-amber-700 dark:text-amber-300">
                {pendingCount} pending change{pendingCount === 1 ? "" : "s"} may affect reports &amp; calculations.
              </span>
              {Object.entries(byEntity).length > 0 && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  ({Object.entries(byEntity).map(([k, v]) => `${v} ${k}`).join(", ")})
                </span>
              )}
              {lastSyncedAt && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  · Last synced: {new Date(lastSyncedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300"
                onClick={() => setShowHistory(true)}
              >
                <History className="mr-1 h-3 w-3" /> History
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-amber-700 hover:bg-amber-100 dark:text-amber-300"
                onClick={() => setDismissed(true)}
              >
                Sync Later
              </Button>
              <Button
                size="sm"
                className="h-7 bg-amber-500 text-white hover:bg-amber-600"
                onClick={() => setShowSyncDialog(true)}
              >
                <Zap className="mr-1 h-3 w-3" /> Sync Now
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Sync Now Dialog ===== */}
      <Dialog open={showSyncDialog} onOpenChange={(o) => { setShowSyncDialog(o); if (!o) setSyncResult(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className={cn("h-5 w-5", theme.text, syncing && "animate-spin")} />
              {syncing ? "Synchronizing…" : syncResult ? "Synchronization Result" : "Data Synchronization"}
            </DialogTitle>
            <DialogDescription>
              {syncResult
                ? `Run ${syncResult.runNumber} completed in ${syncResult.durationMs}ms`
                : `Review pending changes and recalculate all affected modules for ${currentProduct}.`}
            </DialogDescription>
          </DialogHeader>

          {!syncResult && !syncing && (
            <div className="space-y-3">
              {/* Pending summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Pending Changes" value={pendingCount} icon={Activity} tone="amber" />
                <StatCard
                  label="Affected Groups"
                  value={affectedKeys.length}
                  icon={Database}
                  tone="slate"
                />
                <StatCard
                  label="Product"
                  value={currentProduct}
                  icon={Zap}
                  tone={theme.text}
                />
                <StatCard
                  label="Last Synced"
                  value={lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "Never"}
                  icon={Clock}
                  tone="slate"
                />
              </div>

              {/* Affected modules */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Affected Modules
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {["Dashboard", "Statistics", "Remaining Output", "Production Report", "Error Report", "Validation", "Output Slips"].map((m) => (
                      <Badge key={m} variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Changes by action */}
              {Object.keys(byAction).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      Changes by Action
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(byAction).map(([action, count]) => (
                        <Badge key={action} variant="secondary">
                          {action}: {count}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Affected product keys */}
              {affectedKeys.length > 0 && affectedKeys.length <= 10 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      Affected Product Groups ({affectedKeys.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-32 space-y-1 overflow-y-auto scroll-thin">
                      {affectedKeys.map((k) => (
                        <div key={k} className="rounded bg-muted/50 px-2 py-1 font-mono text-xs">
                          {k.split("|").join(" · ")}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>What Sync does</AlertTitle>
                <AlertDescription className="text-xs">
                  Recalculates Order/Output/Input/Pending per affected group, runs validation
                  (Output&gt;Order, Input&gt;Output, etc.), and marks all modules as up-to-date.
                  This does NOT modify your data — it only recalculates derived values.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Syncing state */}
          {syncing && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Recalculating affected product groups…
              </p>
              <div className="text-xs text-muted-foreground">
                Step: Running validation on affected (PO + Factory PO + Size) groups…
              </div>
            </div>
          )}

          {/* Sync result */}
          {syncResult && !syncing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Events Processed" value={syncResult.eventsProcessed} icon={CheckCircle2} tone="emerald" />
                <StatCard label="Groups Recalculated" value={syncResult.productGroupsRecalculated} icon={Database} tone="slate" />
                <StatCard label="Errors Found" value={syncResult.errorsFound} icon={AlertCircle} tone={syncResult.errorsFound > 0 ? "rose" : "emerald"} />
                <StatCard label="Warnings" value={syncResult.warningsFound} icon={AlertTriangle} tone={syncResult.warningsFound > 0 ? "amber" : "emerald"} />
              </div>

              {syncResult.validationErrors && syncResult.validationErrors.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <AlertCircle className="h-4 w-4 text-rose-500" />
                      Validation Errors ({syncResult.validationErrors.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="max-h-48 space-y-2 overflow-y-auto scroll-thin">
                      {syncResult.validationErrors.slice(0, 20).map((err: any, i: number) => (
                        <div key={i} className={cn(
                          "rounded border px-2 py-1.5 text-xs",
                          err.severity === "ERROR"
                            ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
                            : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                        )}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn(
                              "text-[9px]",
                              err.severity === "ERROR" ? "border-rose-400 text-rose-600" : "border-amber-400 text-amber-600"
                            )}>
                              {err.severity}
                            </Badge>
                            <span className="font-medium">{err.title}</span>
                          </div>
                          <div className="mt-0.5 text-muted-foreground">{err.description}</div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{err.productKey}</div>
                        </div>
                      ))}
                      {syncResult.validationErrors.length > 20 && (
                        <div className="text-center text-xs text-muted-foreground">
                          …and {syncResult.validationErrors.length - 20} more
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {syncResult.errorsFound === 0 && syncResult.warningsFound === 0 && (
                <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertTitle className="text-emerald-700">All data is up to date</AlertTitle>
                  <AlertDescription>
                    No validation errors found. All dashboards, statistics, and reports now reflect the latest data.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter>
            {!syncResult && !syncing && (
              <>
                <Button variant="outline" onClick={() => setShowSyncDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSyncNow} className={cn(theme.bg, "text-white hover:opacity-90")}>
                  <Zap className="mr-1 h-4 w-4" /> Start Sync
                </Button>
              </>
            )}
            {syncResult && !syncing && (
              <Button onClick={() => { setShowSyncDialog(false); setSyncResult(null); }}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Sync History Dialog ===== */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              Synchronization History
            </DialogTitle>
            <DialogDescription>Recent sync runs (newest first).</DialogDescription>
          </DialogHeader>
          <div className="max-h-[400px] overflow-y-auto scroll-thin">
            {historyQ.isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : historyQ.data?.history?.length ? (
              <div className="space-y-2">
                {historyQ.data.history.map((run: any) => (
                  <div key={run.id} className="rounded border p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-medium">{run.runNumber}</span>
                      <Badge variant="outline" className={cn(
                        run.status === "completed" ? "border-emerald-400 text-emerald-600" :
                        run.status === "failed" ? "border-rose-400 text-rose-600" :
                        "border-amber-400 text-amber-600"
                      )}>
                        {run.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-muted-foreground">
                      <span>{run.eventsProcessed} events</span>
                      <span>{run.productGroupsRecalculated} groups</span>
                      <span>{run.errorsFound} errors</span>
                      <span>{run.warningsFound} warnings</span>
                      <span>{run.durationMs}ms</span>
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {run.productType || "All products"} · {new Date(run.startedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No sync runs yet.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHistory(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Small stat card helper.
function StatCard({ label, value, icon: Icon, tone }: { label: string; value: React.ReactNode; icon: any; tone: string }) {
  const toneClass: Record<string, string> = {
    amber: "text-amber-600 bg-amber-50 dark:bg-amber-950/30",
    emerald: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30",
    rose: "text-rose-600 bg-rose-50 dark:bg-rose-950/30",
    slate: "text-slate-600 bg-slate-50 dark:bg-slate-950/30",
  };
  return (
    <div className="rounded border p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {tone && <div className={cn("mt-0.5 inline-block h-1 w-8 rounded", toneClass[tone] || tone)} />}
    </div>
  );
}
