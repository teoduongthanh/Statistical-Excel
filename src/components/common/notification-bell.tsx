"use client";

import * as React from "react";
import { Bell, AlertTriangle, AlertCircle, Clock, Package, Info, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const SEVERITY_META = {
  CRITICAL: { icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-900", dot: "bg-red-500" },
  ERROR: { icon: AlertCircle, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-950/30", border: "border-rose-200 dark:border-rose-900", dot: "bg-rose-500" },
  WARNING: { icon: Clock, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-900", dot: "bg-amber-500" },
  INFO: { icon: Info, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/30", border: "border-sky-200 dark:border-sky-900", dot: "bg-sky-500" },
};

const TYPE_LABELS: Record<string, string> = {
  OVERDUE: "Overdue",
  OVERDUE_INPUT: "Late Input",
  DEADLINE_TODAY: "Due Today",
  DEADLINE_TOMORROW: "Due Tomorrow",
  DATA_ERROR: "Data Error",
  SURPLUS: "Surplus",
  NO_OUTPUT: "No Output",
};

export function NotificationBell() {
  const { currentProduct, setView } = useAppStore();
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Poll every 30 seconds.
  const { data, isLoading } = useQuery({
    queryKey: ["notifications", currentProduct],
    queryFn: () => api.getNotifications(currentProduct),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  // Close on outside click.
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const summary = data?.summary;
  const notifications = data?.notifications ?? [];
  const totalCount = summary?.total ?? 0;
  const hasCritical = (summary?.critical ?? 0) > 0;

  function handleClick(n: any) {
    setOpen(false);
    if (n.action) setView(n.action as any);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg hover:bg-accent transition-colors"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {totalCount > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white",
              hasCritical ? "bg-red-500 animate-pulse" : "bg-amber-500"
            )}
          >
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 max-h-[70vh] overflow-hidden rounded-xl border bg-popover shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Notifications</span>
              {totalCount > 0 && (
                <Badge variant="secondary" className="text-[10px]">{totalCount}</Badge>
              )}
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 hover:bg-accent">
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          {/* Summary chips */}
          {summary && totalCount > 0 && (
            <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
              {summary.critical > 0 && (
                <Badge className="bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 text-[10px]">
                  🔴 {summary.critical} Critical
                </Badge>
              )}
              {summary.error > 0 && (
                <Badge className="bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 text-[10px]">
                  ⛔ {summary.error} Errors
                </Badge>
              )}
              {summary.overdue > 0 && (
                <Badge className="bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 text-[10px]">
                  ⏰ {summary.overdue} Overdue
                </Badge>
              )}
              {summary.deadlineToday > 0 && (
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">
                  📅 {summary.deadlineToday} Due Today
                </Badge>
              )}
              {summary.surplus > 0 && (
                <Badge className="bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 text-[10px]">
                  📦 {summary.surplus} Surplus
                </Badge>
              )}
            </div>
          )}

          {/* Notification list */}
          <div className="max-h-[50vh] overflow-y-auto scroll-thin">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                Loading notifications…
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center">
                <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/30">
                  <span className="text-2xl">✓</span>
                </div>
                <p className="text-sm font-medium text-emerald-600">All clear!</p>
                <p className="text-xs text-muted-foreground mt-1">No alerts for {currentProduct}</p>
              </div>
            ) : (
              notifications.map((n) => {
                const meta = SEVERITY_META[n.severity as keyof typeof SEVERITY_META] || SEVERITY_META.INFO;
                const Icon = meta.icon;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50",
                      meta.bg, meta.border
                    )}
                  >
                    <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", meta.bg, meta.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold truncate">{n.title}</span>
                        <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium", meta.bg, meta.color)}>
                          {TYPE_LABELS[n.type] || n.type}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{n.description}</p>
                      {(n.factoryPO || n.poNo) && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                          {n.poNo && <span>PO: {n.poNo}</span>}
                          {n.factoryPO && <span>· FPO: {n.factoryPO}</span>}
                          {n.size && <span>· {n.size}</span>}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t px-4 py-2 text-center">
              <button
                onClick={() => { setOpen(false); setView("product-report" as any); }}
                className="text-xs font-medium text-primary hover:underline"
              >
              View all in Production Report →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
