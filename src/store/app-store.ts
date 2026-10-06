"use client";

import { create } from "zustand";
import type { AppSettings } from "@/types";

// ProductType is now a dynamic string — any product can be registered via DB.
// The hardcoded union "MAFATE" | "ONYX" | "MIZUNO" is replaced by this.
export type ProductType = string;

export type ViewKey =
  | "global-dashboard"
  | "product-dashboard"
  | "product-data-entry"
  | "product-master-data"
  | "product-production-tracking"
  | "product-statistics"
  | "product-shipment"
  | "product-report"
  | "product-bulk-check"
  | "product-order-monitor"
  | "product-output-slip"
  | "product-reconciliation"
  | "product-fvo-stech"
  | "product-import"
  | "product-export"
  | "product-review"
  | "import-history"
  | "settings-mapping"
  | "settings-lookup"
  | "settings-validation"
  | "settings-products"
  | "order-notes";

// ── Product theme ────────────────────────────────────────────────────────────

export interface ProductTheme {
  label: string;
  bg: string;
  text: string;
  border: string;
  badge: string;
  gradient: string;
  chart: string;
}

// Color presets for new products. When a new product is created, the system
// picks the next available color from this list (cycling if all used).
export const COLOR_PRESETS: Record<string, { bg: string; text: string; border: string; badge: string; gradient: string; chart: string }> = {
  emerald: {
    bg: "bg-emerald-500", text: "text-emerald-700", border: "border-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    gradient: "from-emerald-500 to-teal-600", chart: "oklch(0.55 0.14 162)",
  },
  violet: {
    bg: "bg-violet-500", text: "text-violet-700", border: "border-violet-500",
    badge: "bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
    gradient: "from-violet-500 to-purple-600", chart: "oklch(0.55 0.2 300)",
  },
  rose: {
    bg: "bg-rose-500", text: "text-rose-700", border: "border-rose-500",
    badge: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
    gradient: "from-rose-500 to-pink-600", chart: "oklch(0.6 0.2 15)",
  },
  blue: {
    bg: "bg-sky-500", text: "text-sky-700", border: "border-sky-500",
    badge: "bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
    gradient: "from-sky-500 to-blue-600", chart: "oklch(0.55 0.15 230)",
  },
  amber: {
    bg: "bg-amber-500", text: "text-amber-700", border: "border-amber-500",
    badge: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    gradient: "from-amber-500 to-orange-600", chart: "oklch(0.7 0.15 75)",
  },
  cyan: {
    bg: "bg-cyan-500", text: "text-cyan-700", border: "border-cyan-500",
    badge: "bg-cyan-100 text-cyan-700 border-cyan-300 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800",
    gradient: "from-cyan-500 to-teal-600", chart: "oklch(0.6 0.12 195)",
  },
  fuchsia: {
    bg: "bg-fuchsia-500", text: "text-fuchsia-700", border: "border-fuchsia-500",
    badge: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-800",
    gradient: "from-fuchsia-500 to-pink-600", chart: "oklch(0.6 0.2 320)",
  },
  lime: {
    bg: "bg-lime-500", text: "text-lime-700", border: "border-lime-500",
    badge: "bg-lime-100 text-lime-700 border-lime-300 dark:bg-lime-950/40 dark:text-lime-300 dark:border-lime-800",
    gradient: "from-lime-500 to-green-600", chart: "oklch(0.7 0.18 130)",
  },
  indigo: {
    bg: "bg-indigo-500", text: "text-indigo-700", border: "border-indigo-500",
    badge: "bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800",
    gradient: "from-indigo-500 to-blue-600", chart: "oklch(0.5 0.18 265)",
  },
  orange: {
    bg: "bg-orange-500", text: "text-orange-700", border: "border-orange-500",
    badge: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800",
    gradient: "from-orange-500 to-red-600", chart: "oklch(0.65 0.17 45)",
  },
};

// Default themes for built-in products (used before DB products are loaded).
export const PRODUCT_THEME: Record<string, ProductTheme> = {
  MAFATE: {
    label: "MAFATE",
    ...COLOR_PRESETS.emerald,
  },
  ONYX: {
    label: "ONYX",
    ...COLOR_PRESETS.violet,
  },
  MIZUNO: {
    label: "MIZUNO",
    ...COLOR_PRESETS.rose,
  },
  ONYX_FVO: {
    label: "ONYX FVO",
    ...COLOR_PRESETS.cyan,
  },
};

// Generate a ProductTheme from a color name (for dynamic products).
export function themeFromColor(color: string, label: string): ProductTheme {
  const preset = COLOR_PRESETS[color] || COLOR_PRESETS.emerald;
  return { label, ...preset };
}

// ── Dynamic product management ──────────────────────────────────────────────

export interface ProductConfig {
  productType: string;
  label: string;
  slug: string;
  description?: string;
  color: string;
  active: boolean;
  sortOrder: number;
}

interface AppState {
  currentProduct: ProductType;
  setCurrentProduct: (p: ProductType) => void;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  settings: AppSettings | null;
  setSettings: (s: AppSettings) => void;
  refreshKey: number;
  bumpRefresh: () => void;
  // Dynamic products loaded from DB
  products: ProductConfig[];
  setProducts: (p: ProductConfig[]) => void;
  // Dynamic themes (merged from DB + defaults)
  themes: Record<string, ProductTheme>;
  setThemes: (t: Record<string, ProductTheme>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentProduct: "MAFATE",
  setCurrentProduct: (p) => set({ currentProduct: p }),
  view: "product-dashboard",
  setView: (v) => set({ view: v }),
  settings: null,
  setSettings: (s) => set({ settings: s }),
  refreshKey: 0,
  bumpRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  products: [
    { productType: "MAFATE", label: "Mafate", slug: "mafate", color: "emerald", active: true, sortOrder: 0 },
    { productType: "ONYX", label: "Onyx", slug: "onyx", color: "violet", active: true, sortOrder: 1 },
    { productType: "MIZUNO", label: "Mizuno", slug: "mizuno", color: "rose", active: true, sortOrder: 2 },
  ],
  setProducts: (p) => {
    // Rebuild themes from products
    const newThemes: Record<string, ProductTheme> = {};
    for (const prod of p) {
      newThemes[prod.productType] = themeFromColor(prod.color, prod.label);
    }
    set({ products: p, themes: { ...PRODUCT_THEME, ...newThemes } });
  },
  themes: PRODUCT_THEME,
  setThemes: (t) => set({ themes: t }),
}));
