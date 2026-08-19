"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Search, Filter, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildExcelBuffer } from "@/lib/excel";
import { ALL_FIELDS, FIELD_LABELS, type CanonicalField } from "@/lib/fields";

const COLUMNS: CanonicalField[] = [
  "factoryPO",
  "model",
  "sku",
  "poNo",
  "season",
  "colorCode",
  "size",
  "qty1",
  "qty2",
  "shippingStatus",
  "deadline",
];

const FILTER_FIELDS: CanonicalField[] = ["factoryPO", "model", "sku", "poNo", "season", "colorCode", "size", "shippingStatus"];

export function MasterDataView() {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [sort, setSort] = React.useState<{ key: string; order: "asc" | "desc" }>({ key: "factoryPO", order: "asc" });

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    page,
    pageSize,
    search: debouncedSearch,
    ...filters,
    sort: sort.key,
    order: sort.order,
  };

  const q = useQuery({
    queryKey: ["master-data", params],
    queryFn: () => api.listMaster(params),
  });

  function toggleSort(key: string) {
    setSort((s) =>
      s.key === key ? { key, order: s.order === "asc" ? "desc" : "asc" } : { key, order: "asc" }
    );
  }

  async function handleExport() {
    const res = await api.listMaster({ page: 1, pageSize: 1, search: debouncedSearch, ...filters });
    const allRes = await api.listMaster({ page: 1, pageSize: Math.max(res.total, 1), search: debouncedSearch, ...filters });
    const buf = buildExcelBuffer(allRes.rows as any, COLUMNS);
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `master_data_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Global search across Factory PO, SKU, MODEL, Season…"
                className="pl-9 h-10"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-1.5 h-4 w-4" /> Export filtered
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
            {FILTER_FIELDS.map((f) => (
              <Input
                key={f}
                value={filters[f] ?? ""}
                onChange={(e) => {
                  setFilters((p) => ({ ...p, [f]: e.target.value }));
                  setPage(1);
                }}
                placeholder={FIELD_LABELS[f]}
                className="h-9 text-xs"
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" />
              <span className="font-medium">{total.toLocaleString()}</span>
              <span className="text-muted-foreground">rows</span>
              {q.isFetching && <Badge variant="secondary" className="text-[10px]">loading…</Badge>}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded border bg-transparent px-1 py-0.5"
              >
                {[20, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/page</option>)}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground">#</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c}
                      onClick={() => toggleSort(c)}
                      className="cursor-pointer whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase text-muted-foreground hover:text-foreground"
                    >
                      {FIELD_LABELS[c]}
                      {sort.key === c && <span className="ml-1">{sort.order === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-t">
                      <td colSpan={COLUMNS.length + 1} className="px-3 py-3">
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                      </td>
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-muted-foreground">
                      No master data rows found.
                    </td>
                  </tr>
                ) : (
                  rows.map((r: any, i) => (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{(page - 1) * pageSize + i + 1}</td>
                      {COLUMNS.map((c) => (
                        <td key={c} className="px-3 py-1.5 whitespace-nowrap max-w-[220px] truncate" title={r[c] ?? ""}>
                          {c === "factoryPO" ? (
                            <span className="font-medium text-primary">{r[c]}</span>
                          ) : c === "size" ? (
                            <Badge variant="outline" className="font-mono text-[10px]">{r[c]}</Badge>
                          ) : r[c] ? (
                            r[c]
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <span className="text-xs text-muted-foreground">
              Page {page} of {q.data?.totalPages ?? 1}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= (q.data?.totalPages ?? 1)}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
