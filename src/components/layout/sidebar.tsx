"use client";

import {
  LayoutDashboard,
  Database,
  PenLine,
  Table2,
  FileSpreadsheet,
  Upload,
  Download,
  History,
  Settings2,
  Search,
  ShieldCheck,
  FileCog,
} from "lucide-react";
import { useAppStore, type ViewKey } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  desc?: string;
}
interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: "Overview",
    items: [{ key: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Data",
    items: [
      { key: "master-data", label: "Master Data", icon: Database },
      { key: "data-entry", label: "Data Entry", icon: PenLine, desc: "Smart form" },
      { key: "data-management", label: "Data Management", icon: Table2 },
    ],
  },
  {
    title: "Excel",
    items: [
      { key: "import-excel", label: "Import Excel", icon: Upload },
      { key: "export-excel", label: "Export Excel", icon: Download },
      { key: "import-history", label: "Import History", icon: History },
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

export function Sidebar() {
  const { view, setView } = useAppStore();
  return (
    <aside className="hidden md:flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">Smart Excel</div>
          <div className="text-[11px] text-sidebar-foreground/70 leading-tight">
            Data Entry System
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scroll-thin px-3 py-4 space-y-5">
        {NAV.map((group) => (
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
                    {item.key === "data-entry" && (
                      <Badge
                        variant="secondary"
                        className="h-4 px-1 text-[9px] bg-sidebar-accent text-sidebar-accent-foreground"
                      >
                        CORE
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-sidebar-foreground/60">
          <Settings2 className="h-3.5 w-3.5" />
          <span>v1.0 · 3-field workflow</span>
        </div>
      </div>
    </aside>
  );
}
