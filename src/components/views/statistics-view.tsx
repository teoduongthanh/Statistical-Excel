"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, TrendingUp, TrendingDown, Package, CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const COMPANY_BADGE: Record<string, string> = {
  mafate: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300",
  onyx: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300",
  hoongwon: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300",
};

export function StatisticsView() {
  const { company, refreshKey } = useAppStore();
  const [range, setRange] = React.useState<"7" | "30" | "90">("30");
  const q = useQuery({
    queryKey: ["production-stats", company, range, refreshKey],
    queryFn: () => api.productionStats({ company: company === "all" ? undefined : company }),
  });
  const s = q.data;

  const completionColor = (s?.completionRate ?? 0) >= 90 ? "text-emerald-600" : (s?.completionRate ?? 0) >= 70 ? "text-amber-600" : "text-rose-600";

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={TrendingUp} label="Total Order" value={s?.totalOrder ?? 0} color="text-emerald-600" loading={q.isLoading} />
        <Kpi icon={Package} label="Total Output" value={s?.totalOutput ?? 0} color="text-teal-600" loading={q.isLoading} />
        <Kpi icon={TrendingDown} label="Total Input" value={s?.totalInput ?? 0} color="text-cyan-600" loading={q.isLoading} />
        <Kpi icon={CheckCircle2} label="Completion Rate" value={s?.completionRate ?? 0} suffix="%" color={completionColor} loading={q.isLoading} />
      </div>

      {/* Output vs Input over time */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Output vs Input over time</span>
            <div className="flex gap-1">
              {(["7", "30", "90"] as const).map((r) => (
                <Button key={r} size="sm" variant={range === r ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setRange(r)}>
                  {r}d
                </Button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={(s?.byDate ?? []).slice(-Number(range))} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="order" stroke="oklch(0.55 0.14 162)" strokeWidth={2} name="Order" dot={false} />
                <Line type="monotone" dataKey="output" stroke="oklch(0.6 0.13 200)" strokeWidth={2} name="Output" dot={false} />
                <Line type="monotone" dataKey="input" stroke="oklch(0.65 0.2 40)" strokeWidth={2} name="Input" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* By company */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Production by Company</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s?.byCompany ?? []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="company" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="order" fill="oklch(0.55 0.14 162)" radius={[4, 4, 0, 0]} name="Order" />
                  <Bar dataKey="output" fill="oklch(0.6 0.13 200)" radius={[4, 4, 0, 0]} name="Output" />
                  <Bar dataKey="input" fill="oklch(0.65 0.2 40)" radius={[4, 4, 0, 0]} name="Input" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top incomplete orders */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top Incomplete Orders (shortage)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-thin">
              {q.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-muted" />)
              ) : (s?.topIncomplete ?? []).length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No incomplete orders.</div>
              ) : (
                (s?.topIncomplete ?? []).map((t, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{t.factoryPO}</div>
                      <div className="text-muted-foreground">{t.poNo}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold text-rose-600">−{t.shortage}</div>
                      <Badge variant="outline" className={cn("text-[9px] py-0",
                        t.completionRate >= 70 ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300" : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300")}>
                        {t.completionRate}%
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, color, suffix, loading }: { icon: any; label: string; value: number; color: string; suffix?: string; loading?: boolean }) {
  return (
    <Card><CardContent className="p-4">
      <Icon className={cn("h-4 w-4 mb-1", color)} />
      <div className={cn("text-2xl font-bold tabular-nums", color)}>
        {loading ? "—" : `${value.toLocaleString()}${suffix || ""}`}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </CardContent></Card>
  );
}
