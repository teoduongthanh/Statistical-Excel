"use client";

import { Moon, Sun, Menu, FileSpreadsheet } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore, type ViewKey } from "@/store/app-store";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const VIEW_TITLES: Record<ViewKey, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Overview of your master data & entries" },
  "master-data": { title: "Master Data", subtitle: "Browse & filter imported Excel rows" },
  "data-entry": { title: "Smart Data Entry", subtitle: "Enter Factory PO + Size + Qty — the rest is auto-filled" },
  "data-management": { title: "Data Management", subtitle: "Manage created entry rows" },
  "import-excel": { title: "Import Excel", subtitle: "Upload, map columns & build Master Data" },
  "export-excel": { title: "Export Excel", subtitle: "Export entries or master data with column selection" },
  "import-history": { title: "Import History", subtitle: "Past imports & error reports" },
  "settings-mapping": { title: "Column Mapping", subtitle: "Map Excel headers to system fields" },
  "settings-lookup": { title: "Lookup Rules", subtitle: "Configure auto-fill lookup keys" },
  "settings-validation": { title: "Validation Rules", subtitle: "Validation & auto-calculation settings" },
};

export function Header() {
  const { theme, setTheme } = useTheme();
  const { view, setView } = useAppStore();
  const meta = VIEW_TITLES[view];

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur md:px-6">
      {/* Mobile nav */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {(Object.keys(VIEW_TITLES) as ViewKey[]).map((v) => (
            <DropdownMenuItem key={v} onClick={() => setView(v)} className={cn(view === v && "bg-accent")}>
              {VIEW_TITLES[v].title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="md:hidden flex items-center gap-2">
        <FileSpreadsheet className="h-5 w-5 text-primary" />
        <span className="font-semibold">Smart Excel</span>
      </div>

      <div className="hidden md:block min-w-0">
        <h1 className="text-lg font-semibold leading-tight truncate">{meta.title}</h1>
        <p className="text-xs text-muted-foreground leading-tight truncate">{meta.subtitle}</p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {view !== "data-entry" && (
          <Button
            size="sm"
            onClick={() => setView("data-entry")}
            className="hidden sm:inline-flex"
          >
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
