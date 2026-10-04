// Central route configuration — maps URL segments to modules and features.
// Spec §12: manage routes centrally so adding a new module only requires
// registering it here (no need to modify dozens of components).

import type { ProductType } from "@/store/app-store";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, PenLine, Database, GitCompareArrows, Activity,
  BarChart3, Truck, ShieldCheck, ClipboardCheck, Monitor, FileOutput,
  GitCompare, ArrowLeftRight, Upload, Download,
} from "lucide-react";

// ── Module configuration ─────────────────────────────────────────────────────

export interface ModuleConfig {
  slug: string; // URL segment: "onyx" | "mafate" | "mizuno"
  productType: ProductType; // "ONYX" | "MAFATE" | "MIZUNO"
  label: string;
}

export const MODULES: ModuleConfig[] = [
  { slug: "onyx", productType: "ONYX", label: "Onyx" },
  { slug: "mafate", productType: "MAFATE", label: "Mafate" },
  { slug: "mizuno", productType: "MIZUNO", label: "Mizuno" },
];

export function getModule(slug: string): ModuleConfig | undefined {
  return MODULES.find((m) => m.slug === slug);
}

export function getModuleByProduct(pt: ProductType): ModuleConfig | undefined {
  return MODULES.find((m) => m.productType === pt);
}

// ── Feature configuration ────────────────────────────────────────────────────

export interface FeatureConfig {
  slug: string; // URL segment: "order" | "output" | "data-entry" | etc.
  label: string;
  icon: LucideIcon;
  // Which view component to render
  view: ViewComponent;
  // Optional shipping status filter (for order/output/input/pending pages)
  statusFilter?: string;
  // Whether this feature is product-specific (requires a module in the URL)
  productScoped: boolean;
}

export type ViewComponent =
  | "dashboard"
  | "data-entry"
  | "master-data"
  | "production-tracking"
  | "statistics"
  | "shipment"
  | "report"
  | "bulk-check"
  | "order-monitor"
  | "output-slip"
  | "reconciliation"
  | "fvo-stech"
  | "import"
  | "export"
  | "review";

// All features available per module.
// The spec asks for: order, output, input, pending, data-entry.
// We also include all existing features for backward compatibility.
export const FEATURES: FeatureConfig[] = [
  // Spec §2: status-filtered master data views
  { slug: "order", label: "Order", icon: Database, view: "master-data", statusFilter: "1.Order", productScoped: true },
  { slug: "output", label: "Output", icon: Database, view: "master-data", statusFilter: "2.Output", productScoped: true },
  { slug: "input", label: "Input", icon: Database, view: "master-data", statusFilter: "4.Input", productScoped: true },
  { slug: "pending", label: "Pending", icon: Database, view: "master-data", statusFilter: "3.Pending", productScoped: true },
  // Spec §2: data entry
  { slug: "data-entry", label: "Data Entry", icon: PenLine, view: "data-entry", productScoped: true },
  // Existing features
  { slug: "master-data", label: "Master Data", icon: Database, view: "master-data", productScoped: true },
  { slug: "production-tracking", label: "Production Tracking", icon: Activity, view: "production-tracking", productScoped: true },
  { slug: "statistics", label: "Statistics", icon: BarChart3, view: "statistics", productScoped: true },
  { slug: "shipment", label: "Daily Shipment", icon: Truck, view: "shipment", productScoped: true },
  { slug: "report", label: "Report & Validation", icon: ShieldCheck, view: "report", productScoped: true },
  { slug: "bulk-check", label: "Bulk Check", icon: ClipboardCheck, view: "bulk-check", productScoped: true },
  { slug: "order-monitor", label: "Order Monitor", icon: Monitor, view: "order-monitor", productScoped: true },
  { slug: "output-slip", label: "Output Slips", icon: FileOutput, view: "output-slip", productScoped: true },
  { slug: "reconciliation", label: "Reconciliation", icon: GitCompare, view: "reconciliation", productScoped: true },
  { slug: "fvo-stech", label: "FVO ↔ STECH", icon: ArrowLeftRight, view: "fvo-stech", productScoped: true },
  { slug: "import", label: "Import Excel", icon: Upload, view: "import", productScoped: true },
  { slug: "export", label: "Export Excel", icon: Download, view: "export", productScoped: true },
  { slug: "review", label: "Review & Merge", icon: GitCompareArrows, view: "review", productScoped: true },
];

export function getFeature(slug: string): FeatureConfig | undefined {
  return FEATURES.find((f) => f.slug === slug);
}

// ── Breadcrumb helper ────────────────────────────────────────────────────────

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [{ label: "Dashboard", href: "/dashboard" }];

  // /dashboard/[module]
  const parts = pathname.replace(/^\/dashboard\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return crumbs;

  const moduleSlug = parts[0];
  const moduleConfig = getModule(moduleSlug);
  if (!moduleConfig) return crumbs;

  crumbs.push({ label: moduleConfig.label, href: `/dashboard/${moduleConfig.slug}` });

  if (parts.length >= 2) {
    const featureSlug = parts[1];
    const feature = getFeature(featureSlug);
    if (feature) {
      crumbs.push({
        label: feature.label,
        href: `/dashboard/${moduleConfig.slug}/${feature.slug}`,
      });
    }
  }

  return crumbs;
}

// ── Sidebar navigation structure ────────────────────────────────────────────

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  // Pattern to match for active state (e.g. "/dashboard/onyx" matches all onyx sub-routes)
  activePattern: string;
}

export function buildNavGroups(): NavGroup[] {
  const groups: NavGroup[] = [];

  // Global section
  groups.push({
    title: "Global",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, activePattern: "/dashboard" },
    ],
  });

  // Per-module sections
  for (const m of MODULES) {
    const moduleItems: NavItem[] = [
      { label: "Overview", href: `/dashboard/${m.slug}`, icon: LayoutDashboard, activePattern: `/dashboard/${m.slug}` },
    ];
    // Add key features from spec
    for (const f of FEATURES) {
      if (!f.productScoped) continue;
      moduleItems.push({
        label: f.label,
        href: `/dashboard/${m.slug}/${f.slug}`,
        icon: f.icon,
        activePattern: `/dashboard/${m.slug}/${f.slug}`,
      });
    }
    groups.push({ title: m.label, items: moduleItems });
  }

  return groups;
}
