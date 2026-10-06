"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun, Menu, FileSpreadsheet, Factory } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore, PRODUCT_THEME, themeFromColor } from "@/store/app-store";
import { getModules, FEATURES } from "@/lib/route-config";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// Derive page title/subtitle from URL pathname.
function getPageMeta(pathname: string): { title: string; subtitle: string; productScoped: boolean } {
  // Global routes
  if (pathname === "/dashboard") return { title: "Global Dashboard", subtitle: "Compare MAFATE vs ONYX vs MIZUNO", productScoped: false };
  if (pathname === "/import-history") return { title: "Import History", subtitle: "Past imports & error reports", productScoped: false };
  if (pathname === "/order-notes") return { title: "Order Notes", subtitle: "Daily notes for orders", productScoped: false };
  if (pathname === "/settings/mapping") return { title: "Column Mapping", subtitle: "Map Excel headers to system fields", productScoped: false };
  if (pathname === "/settings/lookup") return { title: "Lookup Rules", subtitle: "Configure auto-fill lookup keys", productScoped: false };
  if (pathname === "/settings/validation") return { title: "Validation Rules", subtitle: "Validation & auto-calculation settings", productScoped: false };

  // Module routes: /dashboard/[module] or /dashboard/[module]/[feature]
  const parts = pathname.replace(/^\/dashboard\/?/, "").split("/").filter(Boolean);
  if (parts.length >= 1) {
    const moduleConfig = getModules().find((m) => m.slug === parts[0]);
    if (moduleConfig) {
      if (parts.length === 1) {
        return { title: `${moduleConfig.label} Dashboard`, subtitle: "Production KPIs & alerts", productScoped: true };
      }
      const feature = FEATURES.find((f) => f.slug === parts[1]);
      if (feature) {
        const subtitles: Record<string, string> = {
          "order": "All 1.Order rows",
          "output": "All 2.Output rows",
          "input": "All 4.Input rows",
          "pending": "All 3.Pending rows",
          "data-entry": "Factory PO + Size + Qty → auto-fill",
          "master-data": "Browse, filter & edit imported rows",
          "production-tracking": "Order → Output → Input timeline",
          "statistics": "By Size / Color / Model / PO / Date",
          "shipment": "Calculate remaining output, detect surplus",
          "report": "Track production, detect data anomalies",
          "bulk-check": "Copy & paste from Excel → validate → import",
          "order-monitor": "Order Creation + Deadline monitoring",
          "output-slip": "Bulk output slips by PO NO# + Factory PO",
          "reconciliation": "Compare Excel vs Website data",
          "fvo-stech": "FVO ↔ STECH inventory tracking",
          "import": "Upload, map columns & build Master Data",
          "export": "Export entries or master data",
          "review": "Compare entry data with Master Data",
        };
        return { title: feature.label, subtitle: subtitles[feature.slug] || "", productScoped: true };
      }
    }
  }

  return { title: "Smart Excel Data Entry", subtitle: "Production management system", productScoped: false };
}

export function Header() {
  const { theme, setTheme } = useTheme();
  const { currentProduct, themes } = useAppStore();
  const pathname = usePathname();
  const meta = getPageMeta(pathname);
  // Use dynamic theme from store, fallback to PRODUCT_THEME, then to blue preset
  const pTheme = themes[currentProduct] || PRODUCT_THEME[currentProduct] || themeFromColor("blue", currentProduct);

  // Get current moduleConfig.slug for product switcher links
  const parts = pathname.replace(/^\/dashboard\/?/, "").split("/").filter(Boolean);
  const currentModuleSlug = parts[0] || "";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      {/* Mobile menu — quick links */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem asChild><Link href="/dashboard">Global Dashboard</Link></DropdownMenuItem>
          {getModules().map((m) => (
            <DropdownMenuItem key={m.slug} asChild>
              <Link href={`/dashboard/${m.slug}`}>{m.label}</Link>
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

      {/* Right side: product switcher + new entry + theme toggle */}
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
              {getModules().map((m) => {
                const t = themes[m.productType] || PRODUCT_THEME[m.productType] || themeFromColor("blue", m.label);
                return (
                  <DropdownMenuItem key={m.slug} asChild>
                    <Link href={`/dashboard/${m.slug}`}>
                      <span className={cn("h-2 w-2 rounded-full mr-2", t.bg)} />
                      {m.label}
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {meta.productScoped && (
          <Link href={`/dashboard/${currentModuleSlug}/data-entry`}>
            <Button size="sm" className="hidden sm:inline-flex">
              New Entry
            </Button>
          </Link>
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
