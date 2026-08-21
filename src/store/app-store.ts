"use client";

import { create } from "zustand";
import type { AppSettings } from "@/types";

export type ViewKey =
  | "dashboard"
  | "master-data"
  | "data-entry"
  | "data-management"
  | "import-excel"
  | "export-excel"
  | "import-history"
  | "settings-mapping"
  | "settings-lookup"
  | "settings-validation"
  | "quantity-validation"
  | "production-stats"
  | "order-notes";

interface AppState {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  settings: AppSettings | null;
  setSettings: (s: AppSettings) => void;
  refreshKey: number;
  bumpRefresh: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "dashboard",
  setView: (v) => set({ view: v }),
  settings: null,
  setSettings: (s) => set({ settings: s }),
  refreshKey: 0,
  bumpRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));
