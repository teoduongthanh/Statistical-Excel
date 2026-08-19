"use client";

import * as React from "react";
import { Search, Loader2, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import type { AutocompleteSuggestion } from "@/types";
import type { CanonicalField } from "@/lib/fields";

interface SmartAutocompleteProps {
  field: CanonicalField;
  value: string;
  onChange: (v: string) => void;
  onSelect?: (suggestion: AutocompleteSuggestion) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
}

export function SmartAutocomplete({
  field,
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
  className,
  autoFocus,
}: SmartAutocompleteProps) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<AutocompleteSuggestion[]>([]);
  const [hi, setHi] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const reqId = React.useRef(0);

  // Debounced server-side search (300ms) per spec §39.
  React.useEffect(() => {
    const q = value.trim();
    if (!q || q.length < 1) {
      setItems([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchMaster(q, field, 15);
        if (id !== reqId.current) return;
        setItems(res);
        setOpen(res.length > 0);
        setHi(0);
      } catch {
        if (id === reqId.current) setItems([]);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [value, field]);

  // Close on outside click.
  React.useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(s: AutocompleteSuggestion) {
    onChange(s.value);
    setOpen(false);
    onSelect?.(s);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) {
      if (e.key === "ArrowDown" && value.trim()) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((p) => (p + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((p) => (p - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(items[hi]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => {
            if (items.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          className="flex h-11 w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!loading && value && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setItems([]);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {!loading && !value && (
          <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        )}
      </div>

      {open && items.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg">
          <ul className="max-h-72 overflow-y-auto scroll-thin py-1">
            {items.map((s, i) => (
              <li key={s.value + i}>
                <button
                  type="button"
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(s)}
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors",
                    i === hi ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                  )}
                >
                  <span className="font-medium">{s.value}</span>
                  {s.sub && (
                    <span className="ml-auto text-xs text-muted-foreground truncate max-w-[50%]">
                      {s.sub}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            {items.length} suggestion{items.length !== 1 ? "s" : ""} · fuzzy match
          </div>
        </div>
      )}
    </div>
  );
}
