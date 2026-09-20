"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StickyNote,
  Plus,
  Calendar,
  Trash2,
  Pencil,
  Search,
  Loader2,
  Inbox,
  Save,
  User,
  Hash,
} from "lucide-react";
import { SmartAutocomplete } from "@/components/common/smart-autocomplete";
import { api } from "@/lib/api-client";
import { cn, formatDateDisplay } from "@/lib/utils";
import { toast } from "sonner";
import type { OrderNote } from "@/types";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const COMMON_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "OS"];

/** Returns today's date as YYYY-MM-DD in local time (not UTC). */
function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Formats an ISO date string (YYYY-MM-DD) into e.g. "Mon, Jan 15, 2026". */
function formatNoteDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Formats an ISO timestamp into a short local time like "3:42 PM". */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** True when the YYYY-MM-DD date string equals today (local). */
function isToday(iso: string): boolean {
  return iso === todayLocalISO();
}

interface GroupedNotes {
  date: string;
  notes: OrderNote[];
}

/** Groups notes by noteDate (descending) preserving in-group createdAt order. */
function groupByDate(notes: OrderNote[]): GroupedNotes[] {
  const map = new Map<string, OrderNote[]>();
  for (const n of notes) {
    const key = n.noteDate;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  return Array.from(map.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, items]) => ({
      date,
      // Most recent first within the day.
      notes: items
        .slice()
        .sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
        ),
    }));
}

/* ------------------------------------------------------------------ */
/* Create-note form                                                   */
/* ------------------------------------------------------------------ */

interface NewNoteForm {
  factoryPO: string;
  size: string;
  noteDate: string;
  content: string;
  poNo: string;
  author: string;
}

function CreateNoteForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = React.useState<NewNoteForm>({
    factoryPO: "",
    size: "",
    noteDate: todayLocalISO(),
    content: "",
    poNo: "",
    author: "",
  });
  const [submitting, setSubmitting] = React.useState(false);

  const update = React.useCallback(
    <K extends keyof NewNoteForm>(key: K, value: NewNoteForm[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
    },
    []
  );

  const canSubmit =
    form.factoryPO.trim() &&
    form.size.trim() &&
    form.noteDate &&
    form.content.trim() &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await api.createNote({
        factoryPO: form.factoryPO.trim(),
        size: form.size.trim(),
        noteDate: form.noteDate,
        content: form.content.trim(),
        poNo: form.poNo.trim() || undefined,
        author: form.author.trim() || undefined,
      });
      toast.success("Note added", {
        description: `${created.factoryPO} · Size ${created.size} · ${formatNoteDate(
          created.noteDate
        )}`,
      });
      setForm({
        factoryPO: "",
        size: "",
        noteDate: todayLocalISO(),
        content: "",
        poNo: "",
        author: "",
      });
      onCreated();
    } catch (err) {
      toast.error("Failed to add note", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-emerald-200/60 bg-gradient-to-br from-emerald-50/80 via-amber-50/40 to-teal-50/60 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-amber-950/10 dark:to-teal-950/20">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-300 text-amber-900 shadow-sm">
            <StickyNote className="h-4 w-4" />
          </span>
          New Order Note
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Factory PO */}
            <div className="grid gap-1.5">
              <Label htmlFor="nf-fpo" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Factory PO <span className="text-destructive">*</span>
              </Label>
              <SmartAutocomplete
                field="factoryPO"
                value={form.factoryPO}
                onChange={(v) => update("factoryPO", v)}
                placeholder="Search Factory PO…"
              />
            </div>

            {/* Size */}
            <div className="grid gap-1.5">
              <Label htmlFor="nf-size" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Size <span className="text-destructive">*</span>
              </Label>
              <Input
                id="nf-size"
                list="nf-size-options"
                value={form.size}
                onChange={(e) => update("size", e.target.value)}
                placeholder="e.g. M, 42, OS"
                className="h-11"
              />
              <datalist id="nf-size-options">
                {COMMON_SIZES.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>

            {/* Note date */}
            <div className="grid gap-1.5">
              <Label htmlFor="nf-date" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Note Date <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="nf-date"
                  type="date"
                  value={form.noteDate}
                  onChange={(e) => update("noteDate", e.target.value)}
                  className="h-11 pl-9"
                />
              </div>
            </div>

            {/* Author */}
            <div className="grid gap-1.5">
              <Label htmlFor="nf-author" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Author
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="nf-author"
                  value={form.author}
                  onChange={(e) => update("author", e.target.value)}
                  placeholder="Optional"
                  className="h-11 pl-9"
                />
              </div>
            </div>
          </div>

          {/* PO No (optional) */}
          <div className="grid gap-1.5 md:max-w-sm">
            <Label htmlFor="nf-pono" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              PO No.
            </Label>
            <div className="relative">
              <Hash className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="nf-pono"
                value={form.poNo}
                onChange={(e) => update("poNo", e.target.value)}
                placeholder="Optional PO number"
                className="h-11 pl-9"
              />
            </div>
          </div>

          {/* Content */}
          <div className="grid gap-1.5">
            <Label htmlFor="nf-content" className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Content <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="nf-content"
              value={form.content}
              onChange={(e) => update("content", e.target.value)}
              placeholder="What's happening with this order today? Delays, changes, follow-ups, issues…"
              rows={4}
              className="resize-y bg-yellow-50/40 dark:bg-amber-950/10"
            />
            <p className="text-[11px] text-muted-foreground">
              {form.content.length} characters
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              disabled={!canSubmit}
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Add Note
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setForm({
                  factoryPO: "",
                  size: "",
                  noteDate: todayLocalISO(),
                  content: "",
                  poNo: "",
                  author: "",
                })
              }
              disabled={submitting}
            >
              Clear
            </Button>
            {!form.factoryPO.trim() && (
              <span className="text-xs text-muted-foreground">
                Tip: start typing a Factory PO to see fuzzy matches.
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Edit dialog                                                        */
/* ------------------------------------------------------------------ */

interface EditState {
  open: boolean;
  loading: boolean;
  note: OrderNote | null;
  content: string;
  noteDate: string;
  poNo: string;
}

function EditNoteDialog({
  state,
  setState,
  onSaved,
}: {
  state: EditState;
  setState: React.Dispatch<React.SetStateAction<EditState>>;
  onSaved: () => void;
}) {
  function close() {
    setState((s) => ({ ...s, open: false, note: null }));
  }

  async function handleSave() {
    if (!state.note) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      await api.updateNote(state.note.id, {
        content: state.content.trim(),
        noteDate: state.noteDate,
        poNo: state.poNo.trim() || null,
      });
      toast.success("Note updated");
      close();
      onSaved();
    } catch (err) {
      toast.error("Failed to update note", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <Pencil className="h-4 w-4" />
            Edit Note
          </DialogTitle>
        </DialogHeader>
        {state.note && (
          <div className="grid gap-4 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                {state.note.factoryPO}
              </Badge>
              <Badge variant="outline">Size {state.note.size}</Badge>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ed-content" className="text-xs font-medium">
                Content
              </Label>
              <Textarea
                id="ed-content"
                value={state.content}
                onChange={(e) =>
                  setState((s) => ({ ...s, content: e.target.value }))
                }
                rows={5}
                className="resize-y bg-yellow-50/40 dark:bg-amber-950/10"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ed-date" className="text-xs font-medium">
                  Note Date
                </Label>
                <Input
                  id="ed-date"
                  type="date"
                  value={state.noteDate}
                  onChange={(e) =>
                    setState((s) => ({ ...s, noteDate: e.target.value }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ed-pono" className="text-xs font-medium">
                  PO No.
                </Label>
                <Input
                  id="ed-pono"
                  value={state.poNo}
                  onChange={(e) =>
                    setState((s) => ({ ...s, poNo: e.target.value }))
                  }
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={state.loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              state.loading || !state.content.trim() || !state.noteDate
            }
            className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
          >
            {state.loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Delete confirmation dialog                                         */
/* ------------------------------------------------------------------ */

interface DeleteState {
  open: boolean;
  loading: boolean;
  note: OrderNote | null;
}

function DeleteNoteDialog({
  state,
  setState,
  onDeleted,
}: {
  state: DeleteState;
  setState: React.Dispatch<React.SetStateAction<DeleteState>>;
  onDeleted: () => void;
}) {
  function close() {
    setState((s) => ({ ...s, open: false, note: null }));
  }

  async function handleDelete() {
    if (!state.note) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      await api.deleteNote(state.note.id);
      toast.success("Note deleted", {
        description: `${state.note.factoryPO} · Size ${state.note.size}`,
      });
      close();
      onDeleted();
    } catch (err) {
      toast.error("Failed to delete note", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setState((s) => ({ ...s, loading: false }));
    }
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-4 w-4" />
            Delete Note
          </DialogTitle>
        </DialogHeader>
        {state.note && (
          <div className="py-2 text-sm text-muted-foreground">
            Are you sure you want to delete this note for{" "}
            <span className="font-semibold text-foreground">
              {state.note.factoryPO}
            </span>{" "}
            (Size {state.note.size})? This action cannot be undone.
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={state.loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={state.loading}
          >
            {state.loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Single note card                                                   */
/* ------------------------------------------------------------------ */

function NoteCard({
  note,
  onEdit,
  onDelete,
}: {
  note: OrderNote;
  onEdit: (n: OrderNote) => void;
  onDelete: (n: OrderNote) => void;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card shadow-sm transition-all",
        "hover:border-emerald-300 hover:shadow-md dark:hover:border-emerald-800",
        "border-border"
      )}
    >
      {/* Sticky-note accent stripe */}
      <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-amber-300 to-yellow-400" />
      <div className="p-4 pl-5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300">
            {note.factoryPO}
          </Badge>
          <Badge variant="outline" className="font-medium">
            Size {note.size}
          </Badge>
          {note.poNo && (
            <Badge variant="secondary" className="text-xs">
              PO: {note.poNo}
            </Badge>
          )}
          {note.author && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <User className="h-3 w-3" />
              {note.author}
            </span>
          )}
        </div>

        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {note.content}
        </p>

        <div className="mt-3 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatTime(note.createdAt)}
            {note.updatedAt && note.updatedAt !== note.createdAt && (
              <span className="italic opacity-70">· edited</span>
            )}
          </span>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
              onClick={() => onEdit(note)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-destructive hover:bg-red-50 hover:text-destructive dark:hover:bg-red-950/30"
              onClick={() => onDelete(note)}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Loading & empty skeletons                                          */
/* ------------------------------------------------------------------ */

function NoteSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-amber-200" />
      <div className="p-4 pl-5">
        <div className="mb-2 flex gap-2">
          <div className="h-5 w-24 animate-pulse rounded bg-emerald-100 dark:bg-emerald-950/40" />
          <div className="h-5 w-14 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 py-16 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <Inbox className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold">No notes yet</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {hasFilters
          ? "No notes match your filters. Try clearing them or picking another date."
          : "Add your first order note using the form above. Notes are grouped by date so you can track what happens day-to-day."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main view                                                          */
/* ------------------------------------------------------------------ */

export function OrderNotesView() {
  const qc = useQueryClient();
  const queryKey = React.useMemo(() => ["order-notes"] as const, []);

  // Filter bar state (committed on search).
  const [filterFactoryPO, setFilterFactoryPO] = React.useState("");
  const [filterDate, setFilterDate] = React.useState("");
  const [filterSize, setFilterSize] = React.useState("ALL");

  // Committed filters actually used in the query.
  const [committed, setCommitted] = React.useState<{
    factoryPO: string;
    noteDate: string;
    size: string;
  }>({ factoryPO: "", noteDate: "", size: "" });

  // ===== Client-side pagination for the notes timeline =====
  const [notePage, setNotePage] = React.useState(1);
  const NOTE_PAGE_SIZE = 15;

  const params = React.useMemo(
    () => ({
      factoryPO: committed.factoryPO || undefined,
      size: committed.size || undefined,
      noteDate: committed.noteDate || undefined,
    }),
    [committed]
  );

  const notesQuery = useQuery({
    queryKey: [...queryKey, params],
    queryFn: () => api.listNotes(params),
  });

  const notes = notesQuery.data ?? [];
  const noteTotalPages = Math.max(1, Math.ceil(notes.length / NOTE_PAGE_SIZE));
  const pagedNotes = notes.slice(
    (notePage - 1) * NOTE_PAGE_SIZE,
    notePage * NOTE_PAGE_SIZE
  );
  const groups = React.useMemo(() => groupByDate(pagedNotes), [pagedNotes]);

  function applyFilters() {
    setCommitted({
      factoryPO: filterFactoryPO.trim(),
      noteDate: filterDate,
      size: filterSize === "ALL" ? "" : filterSize,
    });
    setNotePage(1);
  }

  function clearFilters() {
    setFilterFactoryPO("");
    setFilterDate("");
    setFilterSize("ALL");
    setCommitted({ factoryPO: "", noteDate: "", size: "" });
    setNotePage(1);
  }

  function invalidate() {
    qc.invalidateQueries({ queryKey: [...queryKey] });
  }

  // Edit / delete dialog state.
  const [editState, setEditState] = React.useState<EditState>({
    open: false,
    loading: false,
    note: null,
    content: "",
    noteDate: todayLocalISO(),
    poNo: "",
  });
  const [deleteState, setDeleteState] = React.useState<DeleteState>({
    open: false,
    loading: false,
    note: null,
  });

  function openEdit(note: OrderNote) {
    setEditState({
      open: true,
      loading: false,
      note,
      content: note.content,
      noteDate: note.noteDate,
      poNo: note.poNo ?? "",
    });
  }

  function openDelete(note: OrderNote) {
    setDeleteState({ open: true, loading: false, note });
  }

  const hasActiveFilters =
    !!committed.factoryPO || !!committed.noteDate || !!committed.size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-300 text-amber-900 shadow-sm">
              <StickyNote className="h-5 w-5" />
            </span>
            Order Notes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily journal for orders — track delays, follow-ups, and changes per
            Factory PO.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
          >
            {notes.length} note{notes.length === 1 ? "" : "s"}
          </Badge>
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {groups.length} day{groups.length === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>

      {/* Create form */}
      <CreateNoteForm onCreated={invalidate} />

      {/* Filter bar */}
      <Card className="border-border bg-card/60">
        <CardContent className="py-4">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="filter-fpo" className="text-xs font-medium">
                Factory PO
              </Label>
              <Input
                id="filter-fpo"
                value={filterFactoryPO}
                onChange={(e) => setFilterFactoryPO(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder="Any Factory PO"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="filter-size" className="text-xs font-medium">
                Size
              </Label>
              <Select
                value={filterSize}
                onValueChange={(v) => setFilterSize(v)}
              >
                <SelectTrigger id="filter-size" className="w-full">
                  <SelectValue placeholder="All sizes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All sizes</SelectItem>
                  {COMMON_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="filter-date" className="text-xs font-medium">
                Note Date
              </Label>
              <Input
                id="filter-date"
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>

            <div className="flex items-end gap-2">
              <Button
                onClick={applyFilters}
                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600"
              >
                <Search className="mr-2 h-4 w-4" />
                Search
              </Button>
              {hasActiveFilters && (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline / list */}
      {notesQuery.isLoading ? (
        <div className="space-y-6">
          {[0, 1].map((g) => (
            <div key={g} className="space-y-3">
              <div className="h-6 w-40 animate-pulse rounded bg-muted" />
              <div className="grid gap-3 md:grid-cols-2">
                <NoteSkeleton />
                <NoteSkeleton />
              </div>
            </div>
          ))}
        </div>
      ) : notesQuery.isError ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-6 text-sm text-destructive">
            Failed to load notes:{" "}
            {notesQuery.error instanceof Error
              ? notesQuery.error.message
              : String(notesQuery.error)}
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters} />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => {
            const today = isToday(group.date);
            return (
              <section key={group.date} className="space-y-3">
                {/* Date header */}
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-background/80 py-2 backdrop-blur">
                  <div className="relative">
                    <div
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm",
                        today
                          ? "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      )}
                    >
                      <Calendar className="h-3 w-3" />
                      {formatNoteDate(group.date)}
                      {today && (
                        <span className="ml-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-950">
                          Today
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
                  <span className="text-xs text-muted-foreground">
                    {group.notes.length} note{group.notes.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Notes for this date */}
                <div className="grid gap-3 md:grid-cols-2">
                  {group.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onEdit={openEdit}
                      onDelete={openDelete}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Pagination footer — only when there are notes to page through */}
      {notes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/60 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            Page {notePage} of {noteTotalPages} ({notes.length} total notes)
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={notePage <= 1}
              onClick={() => setNotePage((p) => Math.max(1, p - 1))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={notePage >= noteTotalPages}
              onClick={() => setNotePage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <EditNoteDialog
        state={editState}
        setState={setEditState}
        onSaved={invalidate}
      />
      <DeleteNoteDialog
        state={deleteState}
        setState={setDeleteState}
        onDeleted={invalidate}
      />
    </div>
  );
}
