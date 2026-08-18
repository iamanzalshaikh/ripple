import { useCallback, useEffect, useRef, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/theme/ui";

interface Props {
  onBack: () => void;
  /** P10.3 lite — Quick capture hands off a just-created note id to auto-open. */
  initialNoteId?: string | null;
  onInitialNoteConsumed?: () => void;
}

type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

const AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * P10.1 — Flow Notes. List + editor. The body textarea reports focus/blur
 * via notes.setActiveNote so main-process dictation (focusedFieldDictation.ts)
 * knows it's a legitimate "dictate into this note" target, not just another
 * Ripple settings field.
 */
export function NotesPage({
  onBack,
  initialNoteId,
  onInitialNoteConsumed,
}: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getRippleApi().notes.list();
      setNotes(res.ok ? (res.items ?? []) : []);
      if (!res.ok) setError(res.message ?? "Failed to load notes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Dictation appends in main process — refresh open editor body without remount.
  useEffect(() => {
    return getRippleApi().onIpcEvent?.("notes:bodyAppended", (payload) => {
      const data = payload as { noteId?: string; body?: string };
      if (!data?.noteId || typeof data.body !== "string") return;
      setNotes((prev) =>
        prev.map((n) =>
          n.id === data.noteId
            ? { ...n, body: data.body!, updatedAt: new Date().toISOString() }
            : n,
        ),
      );
      setOpenNote((prev) => {
        if (!prev || prev.id !== data.noteId) return prev;
        setBody(data.body!);
        return { ...prev, body: data.body! };
      });
    });
  }, []);

  // P10.3 lite — Quick capture hands off a note id created moments ago by
  // the main process; fetch fresh (it won't be in this component's initial
  // list yet) and jump straight into it, focused and ready to dictate.
  useEffect(() => {
    if (!initialNoteId) return;
    let cancelled = false;
    void (async () => {
      const res = await getRippleApi().notes.list();
      if (cancelled || !res.ok) return;
      const items = res.items ?? [];
      setNotes(items);
      const target = items.find((n) => n.id === initialNoteId);
      if (target) {
        openNoteEditor(target);
        requestAnimationFrame(() => bodyRef.current?.focus());
      }
      onInitialNoteConsumed?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNoteId]);

  // Leaving the editor (unmount / switching notes) must clear the
  // main-process "active note" flag, or dictation could keep targeting a
  // note that's no longer open.
  useEffect(() => {
    return () => {
      void getRippleApi().notes.setActiveNote(null);
    };
  }, []);

  const flushSave = useCallback(
    async (id: string, changes: { title?: string; body?: string }) => {
      setSaving(true);
      try {
        const res = await getRippleApi().notes.update({ id, ...changes });
        if (res.ok && res.note) {
          setNotes((prev) => {
            const idx = prev.findIndex((n) => n.id === id);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = res.note!;
            return next;
          });
        }
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const scheduleSave = useCallback(
    (id: string, changes: { title?: string; body?: string }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void flushSave(id, changes);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  async function createAndOpenNote() {
    const res = await getRippleApi().notes.create({
      title: "Untitled note",
      body: "",
    });
    if (!res.ok || !res.note) {
      setError(res.message ?? "Failed to create note");
      return;
    }
    setNotes((prev) => [res.note!, ...prev]);
    openNoteEditor(res.note);
  }

  function openNoteEditor(note: Note) {
    setOpenNote(note);
    setTitle(note.title);
    setBody(note.body);
  }

  async function closeEditor() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (openNote) await flushSave(openNote.id, { title, body });
    }
    await getRippleApi().notes.setActiveNote(null);
    setOpenNote(null);
  }

  async function removeNote(id: string) {
    const res = await getRippleApi().notes.delete(id);
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      if (openNote?.id === id) {
        await getRippleApi().notes.setActiveNote(null);
        setOpenNote(null);
      }
    } else {
      setError(res.message ?? "Failed to delete note");
    }
  }

  if (openNote) {
    return (
      <div className="min-h-full bg-onboard-bg">
        <header className="flex items-center justify-between border-b border-onboard-border-soft px-8 py-6">
          <div className="flex min-w-0 items-center gap-3">
            <SecondaryButton
              onClick={() => void closeEditor()}
              className="px-3 py-1.5"
            >
              ← Notes
            </SecondaryButton>
            <input
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave(openNote.id, { title: e.target.value });
              }}
              className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-onboard-ink focus:outline-none"
              placeholder="Untitled note"
            />
          </div>
          <span className="shrink-0 text-xs text-onboard-subtle">
            {saving ? "Saving…" : "Saved"}
          </span>
        </header>
        <main className="mx-auto max-w-2xl p-8">
          <p className="mb-3 text-xs text-onboard-muted">
            Hold Shift+Space while this box is focused to dictate directly into
            the note.
          </p>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              scheduleSave(openNote.id, { body: e.target.value });
            }}
            onFocus={() => void getRippleApi().notes.setActiveNote(openNote.id)}
            // Do NOT clear active note on blur — Shift+Space opens the Flow Bar
            // and blurs this textarea; clearing here made sticky WhatsApp steal
            // the insert (seen live: note focused → text pasted into WhatsApp).
            // Active note is cleared only when leaving the editor (closeEditor).
            placeholder="Start writing, or hold Shift+Space and dictate…"
            className="h-[60vh] w-full resize-none rounded-2xl border border-onboard-border bg-onboard-surface p-4 text-sm leading-relaxed text-onboard-ink placeholder:text-onboard-subtle focus:border-onboard-accent focus:outline-none"
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-onboard-bg">
      <PageHeader
        title="Notes"
        subtitle="Dictate notes that sync across your machines."
        onBack={onBack}
        actions={
          <PrimaryButton onClick={() => void createAndOpenNote()}>
            New note
          </PrimaryButton>
        }
      />

      <main className="mx-auto max-w-2xl p-8">
        {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}
        {loading ? (
          <p className="text-sm text-onboard-muted">Loading…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-onboard-muted">
            No notes yet. Click "New note" to create one.
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li
                key={note.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-onboard-border bg-onboard-surface px-4 py-3 transition hover:border-onboard-accent/40"
              >
                <button
                  type="button"
                  onClick={() => openNoteEditor(note)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-onboard-ink">
                    {note.title}
                  </p>
                  <p className="truncate text-xs text-onboard-muted">
                    {note.body.trim() ? note.body.trim() : "Empty note"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void removeNote(note.id)}
                  className="shrink-0 text-xs text-onboard-subtle transition hover:text-red-600"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
