"use client";

import { Moon, Sun, Menu, FileSpreadsheet, Factory } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore, PRODUCT_THEME, type ViewKey } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const VIEW_TITLES: Record<ViewKey, { title: string; subtitle: string; productScoped: boolean }> = {
  "global-dashboard": { title: "Global Dashboard", subtitle: "Compare MAFATE vs ONYX vs MIZUNO", productScoped: false },
  "product-dashboard": { title: "Dashboard", subtitle: "Production KPIs & alerts", productScoped: true },
  "product-data-entry": { title: "Smart Data Entry", subtitle: "Factory PO + Size + Qty → auto-fill", productScoped: true },
  "product-master-data": { title: "Master Data", subtitle: "Browse, filter & edit imported rows", productScoped: true },
  "product-production-tracking": { title: "Production Tracking", subtitle: "Order → Output → Input timeline", productScoped: true },
  "product-statistics": { title: "Statistics", subtitle: "By Size / Color / Model / PO / Date", productScoped: true },
  "product-shipment": { title: "Daily Shipment Planning", subtitle: "Calculate remaining output, detect surplus, generate shipment sheets", productScoped: true },
  "product-report": { title: "Production Report & Validation", subtitle: "Track production, detect data anomalies, export reports", productScoped: true },
  "product-bulk-check": { title: "Bulk Data Validation", subtitle: "Copy & paste from Excel → validate → import", productScoped: true },
  "product-output-slip": { title: "Output Slip Generator", subtitle: "Bulk output slips by PO NO# + Factory PO", productScoped: true },
  "product-import": { title: "Import Excel", subtitle: "Upload, map columns & build Master Data", productScoped: true },
  "product-export": { title: "Export Excel", subtitle: "Export entries or master data", productScoped: true },
  "product-review": { title: "Review & Merge", subtitle: "Compare entry data with Master Data side-by-side", productScoped: true },
  "import-history": { title: "Import History", subtitle: "Past imports & error reports", productScoped: false },
  "settings-mapping": { title: "Column Mapping", subtitle: "Map Excel headers to system fields", productScoped: false },
  "settings-lookup": { title: "Lookup Rules", subtitle: "Configure auto-fill lookup keys", productScoped: false },
  "settings-validation": { title: "Validation Rules", subtitle: "Validation & auto-calculation settings", productScoped: false },
  "order-notes": { title: "Order Notes", subtitle: "Daily notes for orders", productScoped: false },
};

export function Header() {
  const { theme, setTheme } = useTheme();
  const { currentProduct, setCurrentProduct, view, setView } = useAppStore();
  const meta = VIEW_TITLES[view];
  const pTheme = PRODUCT_THEME[currentProduct];

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {(Object.keys(VIEW_TITLES) as ViewKey[]).map((v) => (
            <DropdownMenuItem key={v} onClick={() => setView(v)} className={cn(view === v && "bg-accent")}>
              {VIEW_TITLES[v].title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="md:hidden flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <span className="font-semibold">PM</span>
      </div>

      <div className="hidden md:block min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold leading-tight truncate">{meta.title}</h1>
          {meta.productScoped && (
            <Badge className={cn("text-[10px] border", pTheme.badge)}>
              <Factory className="h-2.5 w-2.5 mr-0.5" /> {currentProduct}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-tight truncate">{meta.subtitle}</p>
      </div>

      {/* Product switcher (always visible) */}
      <div className="ml-auto flex items-center gap-2">
        {meta.productScoped && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className={cn("gap-1.5", pTheme.text, pTheme.border)}>
                <Factory className="h-3.5 w-3.5" />
                {currentProduct}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(PRODUCT_THEME) as Array<keyof typeof PRODUCT_THEME>).map((p) => {
                const t = PRODUCT_THEME[p];
                return (
                  <DropdownMenuItem key={p} onClick={() => setCurrentProduct(p)}>
                    <span className={cn("h-2 w-2 rounded-full", t.bg)} />
                    {p}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {view !== "product-data-entry" && meta.productScoped && (
          <Button size="sm" onClick={() => setView("product-data-entry")} className="hidden sm:inline-flex">
            New Entry
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
        <Badge variant="outline" className="hidden lg:inline-flex bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900">
          <span className="mr-1 h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
        </Badge>
      </div>
    </header>
  );
}
