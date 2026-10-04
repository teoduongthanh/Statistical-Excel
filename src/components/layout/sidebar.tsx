"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileSpreadsheet, Settings2, LayoutDashboard, History, FileCog,
  Search, ShieldCheck, StickyNote, ChevronDown, Factory,
  PenLine, Database, GitCompareArrows, Activity, BarChart3,
  Truck, ClipboardCheck, Monitor, FileOutput, GitCompare,
  ArrowLeftRight, Upload, Download,
} from "lucide-react";
import { useAppStore, PRODUCT_THEME, type ProductType } from "@/store/app-store";
import { MODULES, FEATURES } from "@/lib/route-config";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import * as React from "react";

// Global nav links (not product-scoped)
const GLOBAL_LINKS = [
  { label: "Global Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Import History", href: "/import-history", icon: History },
  { label: "Order Notes", href: "/order-notes", icon: StickyNote },
];

const SETTINGS_LINKS = [
  { label: "Column Mapping", href: "/settings/mapping", icon: FileCog },
  { label: "Lookup Rules", href: "/settings/lookup", icon: Search },
  { label: "Validation Rules", href: "/settings/validation", icon: ShieldCheck },
];

// Features shown in sidebar per module.
const FEATURE_LINKS = [
  { slug: "dashboard", label: "Overview", icon: LayoutDashboard, href: "" },
  { slug: "order", label: "Order", icon: Database },
  { slug: "output", label: "Output", icon: Database },
  { slug: "input", label: "Input", icon: Database },
  { slug: "pending", label: "Pending", icon: Database },
  { slug: "data-entry", label: "Data Entry", icon: PenLine },
  { slug: "master-data", label: "Master Data", icon: Database },
  { slug: "production-tracking", label: "Production Tracking", icon: Activity },
  { slug: "statistics", label: "Statistics", icon: BarChart3 },
  { slug: "shipment", label: "Daily Shipment", icon: Truck },
  { slug: "report", label: "Report & Validation", icon: ShieldCheck },
  { slug: "bulk-check", label: "Bulk Check", icon: ClipboardCheck },
  { slug: "order-monitor", label: "Order Monitor", icon: Monitor },
  { slug: "output-slip", label: "Output Slips", icon: FileOutput },
  { slug: "reconciliation", label: "Reconciliation", icon: GitCompare },
  { slug: "fvo-stech", label: "FVO ↔ STECH", icon: ArrowLeftRight },
  { slug: "import", label: "Import Excel", icon: Upload },
  { slug: "export", label: "Export Excel", icon: Download },
  { slug: "review", label: "Review & Merge", icon: GitCompareArrows },
];

export function Sidebar() {
  const pathname = usePathname();
  const { currentProduct } = useAppStore();

  // Determine which module is active from URL.
  // /dashboard/onyx/... → module slug = "onyx"
  const moduleSlug = pathname.startsWith("/dashboard/")
    ? pathname.split("/")[2]
    : "";
  const activeModule = MODULES.find((m) => m.slug === moduleSlug);

  return (
    <aside className="hidden md:flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0">
      {/* Logo */}
      <Link href="/dashboard" className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border hover:bg-sidebar-accent/50 transition-colors">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Production Manager</div>
          <div className="text-[11px] text-sidebar-foreground/70 leading-tight">MAFATE · ONYX · MIZUNO</div>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-4 space-y-5">
        {/* Global nav */}
        <div>
          <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Overview
          </div>
          <div className="space-y-0.5">
            {GLOBAL_LINKS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Settings */}
        <div>
          <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Settings
          </div>
          <div className="space-y-0.5">
            {SETTINGS_LINKS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Product section */}
        <div>
          <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
            Product Context
          </div>

          {/* Product switcher */}
          <div className="mb-2 space-y-1">
            {MODULES.map((m) => {
              const t = PRODUCT_THEME[m.productType];
              const active = activeModule?.slug === m.slug;
              return (
                <Link
                  key={m.slug}
                  href={`/dashboard/${m.slug}`}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all",
                    active
                      ? cn(t.bg, "text-white shadow-md")
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent"
                  )}
                >
                  <Factory className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left">{m.label}</span>
                  {active && <ChevronDown className="h-3 w-3" />}
                </Link>
              );
            })}
          </div>

          {/* Feature links for the active module */}
          {activeModule && (
            <div className="space-y-0.5 border-l-2 ml-2 pl-2" style={{ borderColor: "var(--sidebar-border)" }}>
              {FEATURE_LINKS.map((item) => {
                const Icon = item.icon;
                // For "Overview", href is just /dashboard/[module]
                const href = item.slug === "dashboard"
                  ? `/dashboard/${activeModule.slug}`
                  : `/dashboard/${activeModule.slug}/${item.slug}`;
                const active = pathname === href;
                const theme = PRODUCT_THEME[activeModule.productType];
                return (
                  <Link
                    key={item.slug}
                    href={href}
                    className={cn(
                      "group flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? cn("text-white", theme.bg, "shadow-sm")
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 text-left truncate text-[13px]">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/60">
          <Settings2 className="h-3.5 w-3.5" />
          <span>v4.0 · URL Routing</span>
        </div>
      </div>
    </aside>
  );
}
