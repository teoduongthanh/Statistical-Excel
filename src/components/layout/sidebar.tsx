"use client";

import {
  FileSpreadsheet,
  Settings2,
  LayoutDashboard,
  PenLine,
  Database,
  Activity,
  BarChart3,
  Upload,
  Download,
  History,
  FileCog,
  Search,
  ShieldCheck,
  StickyNote,
  ChevronDown,
  Factory,
  GitCompareArrows,
  Truck,
  ClipboardCheck,
  FileOutput,
  GitCompare,
} from "lucide-react";
import { useAppStore, PRODUCT_THEME, type ProductType, type ViewKey } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const GLOBAL_NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { key: "global-dashboard", label: "Global Dashboard", icon: LayoutDashboard },
      { key: "import-history", label: "Import History", icon: History },
      { key: "order-notes", label: "Order Notes", icon: StickyNote },
    ],
  },
  {
    title: "Settings",
    items: [
      { key: "settings-mapping", label: "Column Mapping", icon: FileCog },
      { key: "settings-lookup", label: "Lookup Rules", icon: Search },
      { key: "settings-validation", label: "Validation Rules", icon: ShieldCheck },
    ],
  },
];

const PRODUCT_NAV: NavGroup[] = [
  {
    title: "",
    items: [
      { key: "product-dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "product-data-entry", label: "Data Entry", icon: PenLine },
      { key: "product-master-data", label: "Master Data", icon: Database },
      { key: "product-review", label: "Review & Merge", icon: GitCompareArrows },
      { key: "product-production-tracking", label: "Production Tracking", icon: Activity },
      { key: "product-statistics", label: "Statistics", icon: BarChart3 },
      { key: "product-shipment", label: "Daily Shipment", icon: Truck },
      { key: "product-report", label: "Report & Validation", icon: ShieldCheck },
      { key: "product-bulk-check", label: "Bulk Check", icon: ClipboardCheck },
      { key: "product-output-slip", label: "Output Slips", icon: FileOutput },
      { key: "product-reconciliation", label: "Reconciliation", icon: GitCompare },
      { key: "product-import", label: "Import Excel", icon: Upload },
      { key: "product-export", label: "Export Excel", icon: Download },
    ],
  },
];

const PRODUCTS: ProductType[] = ["MAFATE", "ONYX", "MIZUNO"];

export function Sidebar() {
  const { currentProduct, setCurrentProduct, view, setView } = useAppStore();
  const theme = PRODUCT_THEME[currentProduct];

  return (
    <aside className="hidden md:flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Production Manager</div>
          <div className="text-[11px] text-sidebar-foreground/70 leading-tight">MAFATE · ONYX · MIZUNO</div>
        </div>
      </div>

      {/* Global nav */}
      <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-4 space-y-5">
        {GLOBAL_NAV.map((group) => (
          <div key={group.title}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = view === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setView(item.key)}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 text-left truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Product section header with switcher */}
        <div>
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              Product Context
            </span>
            <Badge className={cn("text-[9px] border", theme.badge)}>{currentProduct}</Badge>
          </div>

          {/* Product switcher */}
          <div className="mb-2 space-y-1">
            {PRODUCTS.map((p) => {
              const t = PRODUCT_THEME[p];
              const active = currentProduct === p;
              return (
                <button
                  key={p}
                  onClick={() => setCurrentProduct(p)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                    active
                      ? cn(t.bg, "text-white shadow-md")
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
                  )}
                >
                  <Factory className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{p}</span>
                  {active && <ChevronDown className="h-3 w-3" />}
                </button>
              );
            })}
          </div>

          {/* Product-specific nav */}
          <div className="space-y-0.5 border-l-2 ml-2 pl-2" style={{ borderColor: "var(--sidebar-border)" }}>
            {PRODUCT_NAV[0].items.map((item) => {
              const Icon = item.icon;
              const active = view === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? cn("text-white", theme.bg, "shadow-sm")
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 text-left truncate text-[13px]">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/60">
          <Settings2 className="h-3.5 w-3.5" />
          <span>v3.0 · Product Isolated</span>
        </div>
      </div>
    </aside>
  );
}
