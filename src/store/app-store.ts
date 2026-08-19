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
  | "settings-validation";

interface AppState {
  view: ViewKey;
  setView: (v: ViewKey) => void;
  settings: AppSettings | null;
  setSettings: (s: AppSettings) => void;
  // Bump to trigger data refresh after import/entry creation.
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
