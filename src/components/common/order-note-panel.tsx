"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, Calendar } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Props {
  company: string;
  poNo: string;
  factoryPO: string;
  entryId?: string;
}

export function OrderNotePanel({ company, poNo, factoryPO, entryId }: Props) {
  const qc = useQueryClient();
  const [content, setContent] = React.useState("");
  const [noteDate, setNoteDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = React.useState(false);

  const q = useQuery({
    queryKey: ["notes", company, poNo, factoryPO],
    queryFn: () => api.listNotes({ company, poNo, factoryPO, entryId }),
  });

  async function addNote() {
    if (!content.trim()) { toast.error("Note content is required"); return; }
    setSaving(true);
    try {
      await api.createNote({ company, poNo, factoryPO, size: "", entryId, content, noteDate });
      setContent("");
      toast.success("Note added");
      qc.invalidateQueries({ queryKey: ["notes", company, poNo, factoryPO] });
    } catch (e) {
      toast.error("Failed to add note");
    } finally {
      setSaving(false);
    }
  }

  async function removeNote(id: string) {
    if (!confirm("Delete this note?")) return;
    await api.deleteNote(id);
    toast.success("Note deleted");
    qc.invalidateQueries({ queryKey: ["notes", company, poNo, factoryPO] });
  }

  const notes = q.data ?? [];

  return (
    <div className="space-y-3">
      {/* Add note */}
      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="date"
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
            className="h-8 w-40 text-xs"
          />
          <span className="text-xs text-muted-foreground ml-auto">{poNo} · {factoryPO}</span>
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Write a note for this order (e.g. delayed shipment, partial delivery, customer feedback)…"
          rows={3}
          className="text-sm scroll-thin"
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={addNote} disabled={saving || !content.trim()}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
            Add Note
          </Button>
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-2 max-h-80 overflow-y-auto scroll-thin">
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded bg-muted" />)}
          </div>
        ) : notes.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No notes yet for this order.</div>
        ) : (
          notes.map((n) => (
            <div key={n.id} className="group relative rounded-md border p-2.5 hover:bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{new Date(n.noteDate).toLocaleDateString()}</span>
                <span className="text-muted-foreground">by {n.author}</span>
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap break-words">{n.content}</p>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                onClick={() => removeNote(n.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
