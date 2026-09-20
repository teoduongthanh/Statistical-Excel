"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  Table2,
  Factory,
  Tag,
  Box,
  CalendarDays,
  TrendingUp,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useAppStore } from "@/store/app-store";
import { Button } from "@/components/ui/button";

const PIE_COLORS = ["oklch(0.55 0.14 162)", "oklch(0.6 0.13 200)", "oklch(0.7 0.16 90)", "oklch(0.65 0.2 40)", "oklch(0.6 0.2 320)"];

export function DashboardView() {
  const { setView, refreshKey } = useAppStore();
  const q = useQuery({
    queryKey: ["dashboard", refreshKey],
    queryFn: api.dashboard,
  });
  const s = q.data;
  const stats = [
    { label: "Master Records", value: s?.totalMaster ?? 0, icon: Database, color: "text-emerald-600" },
    { label: "Entry Records", value: s?.totalEntries ?? 0, icon: Table2, color: "text-teal-600" },
    { label: "Factory POs", value: s?.totalFactoryPO ?? 0, icon: Factory, color: "text-lime-600" },
    { label: "SKUs", value: s?.totalSKU ?? 0, icon: Tag, color: "text-amber-600" },
    { label: "Models", value: s?.totalModels ?? 0, icon: Box, color: "text-rose-600" },
    { label: "Today's Entries", value: s?.todayEntries ?? 0, icon: CalendarDays, color: "text-cyan-600" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((st) => {
          const Icon = st.icon;
          return (
            <Card key={st.label} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <Icon className={`h-4 w-4 ${st.color}`} />
                </div>
                <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums">
                  {q.isLoading ? "—" : st.value.toLocaleString()}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{st.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4 text-primary" /> Entries by Date (last 14 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s?.entriesByDate ?? []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                  />
                  <Bar dataKey="count" fill="oklch(0.55 0.14 162)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" /> Entries by Season
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={s?.entriesBySeason ?? []}
                    dataKey="count"
                    nameKey="season"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(e) => `${e.season}: ${e.count}`}
                    labelLine={false}
                  >
                    {(s?.entriesBySeason ?? []).map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Factory className="h-4 w-4 text-primary" /> Top Factory POs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s?.entriesByFactoryPO ?? []} layout="vertical" margin={{ left: 20, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis dataKey="factoryPO" type="category" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="count" fill="oklch(0.6 0.13 200)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Box className="h-4 w-4 text-primary" /> Top Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s?.entriesByModel ?? []} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="model" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="count" fill="oklch(0.7 0.16 90)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CTA when empty */}
      {(s?.totalEntries ?? 0) === 0 && !q.isLoading && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Table2 className="h-6 w-6" />
            </div>
            <p className="mt-3 text-sm font-medium">No entries yet</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">
              Start entering data with just Factory PO + Size + Qty1. The system auto-fills the rest.
            </p>
            <Button className="mt-4" onClick={() => setView("data-entry")}>
              Go to Data Entry
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
