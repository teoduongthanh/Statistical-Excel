"use client";

import { create } from "zustand";
import type { AppSettings } from "@/types";

export type ProductType = "MAFATE" | "ONYX" | "MIZUNO";

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
  | "order-notes";

interface AppState {
  currentProduct: ProductType;
  setCurrentProduct: (p: ProductType) => void;
  view: ViewKey;
  setView: (v: ViewKey) => void;
  settings: AppSettings | null;
  setSettings: (s: AppSettings) => void;
  refreshKey: number;
  bumpRefresh: () => void;
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
}));

// Product visual identities — distinct colors per product for isolation.
export const PRODUCT_THEME: Record<ProductType, {
  label: string;
  bg: string;
  text: string;
  border: string;
  badge: string;
  gradient: string;
  chart: string;
}> = {
  MAFATE: {
    label: "MAFATE",
    bg: "bg-emerald-500",
    text: "text-emerald-700",
    border: "border-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    gradient: "from-emerald-500 to-teal-600",
    chart: "oklch(0.55 0.14 162)",
  },
  ONYX: {
    label: "ONYX",
    bg: "bg-violet-500",
    text: "text-violet-700",
    border: "border-violet-500",
    badge: "bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
    gradient: "from-violet-500 to-purple-600",
    chart: "oklch(0.55 0.2 300)",
  },
  MIZUNO: {
    label: "MIZUNO",
    bg: "bg-rose-500",
    text: "text-rose-700",
    border: "border-rose-500",
    badge: "bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
    gradient: "from-rose-500 to-pink-600",
    chart: "oklch(0.6 0.2 15)",
  },
};
