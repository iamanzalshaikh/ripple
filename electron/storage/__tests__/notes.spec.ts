import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; title: string; body: string; created_at: string; updated_at: string };
const store = new Map<string, Row>();

vi.mock("../rippleDb.js", () => ({
  getRippleDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes("INSERT INTO notes")) {
        return {
          run: (id: string, title: string, body: string, created_at: string, updated_at: string) => {
            store.set(id, { id, title, body, created_at, updated_at });
          },
        };
      }
      if (sql.includes("UPDATE notes")) {
        return {
          run: (title: string, body: string, updated_at: string, id: string) => {
            const existing = store.get(id);
            if (existing) store.set(id, { ...existing, title, body, updated_at });
          },
        };
      }
      if (sql.includes("DELETE FROM notes")) {
        return {
          run: (id: string) => {
            const ok = store.delete(id);
            return { changes: ok ? 1 : 0 };
          },
        };
      }
      if (sql.includes("WHERE id = ?")) {
        return {
          get: (id: string) => store.get(id),
        };
      }
      if (sql.includes("ORDER BY updated_at DESC")) {
        return {
          all: () => [...store.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
        };
      }
      return { get: () => undefined, run: () => ({ changes: 0 }), all: () => [] };
    },
  }),
}));

describe("notes storage (P10.1)", () => {
  beforeEach(() => {
    store.clear();
  });

  it("creates a note with a generated id and default title", async () => {
    const { createNote } = await import("../notes.js");
    const note = createNote({ body: "hello" });
    expect(note.id).toBeTruthy();
    expect(note.title).toBe("Untitled note");
    expect(note.body).toBe("hello");
  });

  it("updates title and body independently, leaving the other unchanged", async () => {
    const { createNote, updateNote } = await import("../notes.js");
    const note = createNote({ title: "Groceries", body: "Milk" });
    const updated = updateNote(note.id, { body: "Milk, eggs" });
    expect(updated?.title).toBe("Groceries");
    expect(updated?.body).toBe("Milk, eggs");
  });

  it("updateNote returns null for a note that doesn't exist", async () => {
    const { updateNote } = await import("../notes.js");
    expect(updateNote("nope", { body: "x" })).toBeNull();
  });

  it("deletes a note and reports whether it actually removed one", async () => {
    const { createNote, deleteNote } = await import("../notes.js");
    const note = createNote({ title: "Temp" });
    expect(deleteNote(note.id)).toBe(true);
    expect(deleteNote(note.id)).toBe(false);
  });

  it("lists notes newest-updated first", async () => {
    const { createNote, updateNote, listNotes } = await import("../notes.js");
    const a = createNote({ title: "A" });
    const b = createNote({ title: "B" });
    updateNote(a.id, { title: "A (edited)" });
    const items = listNotes();
    expect(items[0]?.id).toBe(a.id);
    expect(items[1]?.id).toBe(b.id);
  });

  it("upsertNoteFromSync inserts when the id is new, updates when it already exists", async () => {
    const { upsertNoteFromSync, getNote } = await import("../notes.js");
    upsertNoteFromSync({
      id: "cloud-1",
      title: "From cloud",
      body: "v1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(getNote("cloud-1")?.body).toBe("v1");

    upsertNoteFromSync({
      id: "cloud-1",
      title: "From cloud",
      body: "v2",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
    expect(getNote("cloud-1")?.body).toBe("v2");
  });
});
