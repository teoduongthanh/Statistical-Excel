"use client";

import * as React from "react";
import { Search, Loader2, ChevronDown, X, AlertCircle } from "lucide-react";
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
  productType?: string;
  // PO NO# linkage: when field="factoryPO" and poNo is set, only Factory POs
  // that co-occur with this PO NO# in Master Data are suggested.
  poNo?: string;
}

function UrgencyBadge({ urgency, deadline }: { urgency?: string; deadline?: string | null }) {
  if (!urgency || urgency === "normal") return null;
  const styles = {
    overdue: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    today: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    soon: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  };
  const labels = { overdue: "Overdue", today: "Today", soon: "Soon" };
  return (
    <span className={cn("rounded px-1 py-0.5 text-[9px] font-medium", styles[urgency as keyof typeof styles])}>
      {labels[urgency as keyof typeof labels]}
      {deadline && <span className="ml-1 opacity-70">{deadline}</span>}
    </span>
  );
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
  productType,
  poNo,
}: SmartAutocompleteProps) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [items, setItems] = React.useState<AutocompleteSuggestion[]>([]);
  const [hi, setHi] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const reqId = React.useRef(0);
  // Track the value that was just selected by the user. When the value changes
  // because the user picked a suggestion, we must NOT reopen the dropdown —
  // otherwise the search effect fires, finds the exact value, and shows the
  // dropdown again. We clear this flag as soon as the user types (changes the
  // value to something that doesn't equal the selected one).
  //
  // This also prevents the dropdown from reopening when the user presses Enter
  // to select a suggestion and then the focus moves to the next field — the
  // search effect would otherwise re-fire for the now-set value.
  const selectedRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const q = value.trim();
    if (!q || q.length < 1) {
      setItems([]);
      setOpen(false);
      return;
    }
    // If the value equals what the user just selected, don't re-search / reopen.
    // This prevents the dropdown from popping up again after a selection.
    if (selectedRef.current && value === selectedRef.current) {
      return;
    }
    // User typed something different from the selected value → clear the flag.
    selectedRef.current = null;
    setLoading(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchMaster(q, field, 15, true, productType, poNo);
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
  }, [value, field, productType, poNo]);

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
    // Mark this value as "just selected" so the search effect doesn't reopen
    // the dropdown. This is the KEY fix: after selection, the value changes
    // → useEffect fires → but selectedRef matches → we return early → no
    // dropdown. The user can then press Enter again to move to the next field
    // without the dropdown reopening.
    selectedRef.current = s.value;
    onChange(s.value);
    setItems([]);
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
            // Only reopen if the user is actively typing (items already loaded
            // and value is not a freshly-selected exact match).
            if (items.length > 0 && !selectedRef.current) setOpen(true);
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
              selectedRef.current = null;
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
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                    i === hi ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                  )}
                >
                  <span className="font-medium">{s.value}</span>
                  {s.sub && (
                    <span className="text-xs text-muted-foreground truncate max-w-[40%]">
                      {s.sub}
                    </span>
                  )}
                  <span className="ml-auto shrink-0">
                    <UrgencyBadge urgency={s.urgency} deadline={s.deadline} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
            {items.length} suggestion{items.length !== 1 ? "s" : ""} · sorted by deadline urgency + suffix match
          </div>
        </div>
      )}
    </div>
  );
}
