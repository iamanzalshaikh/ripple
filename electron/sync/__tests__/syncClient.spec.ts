import { beforeEach, describe, expect, it, vi } from "vitest";

const learnCorrection = vi.fn();
const removeCorrection = vi.fn();
const learnSnippet = vi.fn();
const removeSnippet = vi.fn();
const setStyleProfile = vi.fn();
const removeStyleProfile = vi.fn();
const updateUserPreference = vi.fn();
const upsertNoteFromSync = vi.fn();
const deleteNote = vi.fn();

vi.mock("../../storage/voiceCorrections.js", () => ({
  learnCorrection: (...args: unknown[]) => learnCorrection(...args),
  removeCorrection: (...args: unknown[]) => removeCorrection(...args),
  listCorrections: () => [],
}));

vi.mock("../../storage/snippets.js", () => ({
  learnSnippet: (...args: unknown[]) => learnSnippet(...args),
  removeSnippet: (...args: unknown[]) => removeSnippet(...args),
  listSnippets: () => [],
}));

vi.mock("../../storage/styleProfiles.js", () => ({
  setStyleProfile: (...args: unknown[]) => setStyleProfile(...args),
  removeStyleProfile: (...args: unknown[]) => removeStyleProfile(...args),
  listStyleProfiles: () => [],
}));

vi.mock("../../storage/userPreferences.js", () => ({
  updateUserPreference: (...args: unknown[]) => updateUserPreference(...args),
  getUserPreferences: () => ({ language: null, quietMode: null, updatedAt: null }),
}));

vi.mock("../../storage/notes.js", () => ({
  upsertNoteFromSync: (...args: unknown[]) => upsertNoteFromSync(...args),
  deleteNote: (...args: unknown[]) => deleteNote(...args),
  listNotes: () => [],
}));

describe("P9.1 syncClient.applyPulledItem — routes pulled items to local storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dictionary: applies a live item via learnCorrection", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "dictionary",
      key: "tathir",
      payload: { canonicalForm: "Tathir", source: "dictionary_ui" },
      deleted: false,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(learnCorrection).toHaveBeenCalledWith({
      spokenForm: "tathir",
      canonicalForm: "Tathir",
      source: "dictionary_ui",
    });
    expect(removeCorrection).not.toHaveBeenCalled();
  });

  it("dictionary: a tombstone calls removeCorrection instead", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "dictionary",
      key: "tathir",
      payload: {},
      deleted: true,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(removeCorrection).toHaveBeenCalledWith("tathir");
    expect(learnCorrection).not.toHaveBeenCalled();
  });

  it("snippet: applies via learnSnippet", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "snippet",
      key: "sig",
      payload: { expansion: "Best, Anzal" },
      deleted: false,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(learnSnippet).toHaveBeenCalledWith({ trigger: "sig", expansion: "Best, Anzal" });
  });

  it("style: applies via setStyleProfile", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "style",
      key: "chrome",
      payload: { tone: "professional" },
      deleted: false,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(setStyleProfile).toHaveBeenCalledWith({ processName: "chrome", tone: "professional" });
  });

  it("preference: applies known keys (language, quiet_mode) via updateUserPreference", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "preference",
      key: "language",
      payload: { value: "hi" },
      deleted: false,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(updateUserPreference).toHaveBeenCalledWith("language", "hi");
  });

  it("preference: ignores unknown preference keys (no crash, no local storage call)", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "preference",
      key: "something_unrecognized",
      payload: { value: "x" },
      deleted: false,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(updateUserPreference).not.toHaveBeenCalled();
  });

  it("note: applies a live item via upsertNoteFromSync, preserving createdAt from payload", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "note",
      key: "note-abc",
      payload: { title: "Groceries", body: "Milk, eggs", createdAt: "2025-12-01T00:00:00Z" },
      deleted: false,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(upsertNoteFromSync).toHaveBeenCalledWith({
      id: "note-abc",
      title: "Groceries",
      body: "Milk, eggs",
      createdAt: "2025-12-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(deleteNote).not.toHaveBeenCalled();
  });

  it("note: a tombstone calls deleteNote instead", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    applyPulledItem({
      kind: "note",
      key: "note-abc",
      payload: {},
      deleted: true,
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(deleteNote).toHaveBeenCalledWith("note-abc");
    expect(upsertNoteFromSync).not.toHaveBeenCalled();
  });

  it("unknown kind is a silent no-op, not a crash", async () => {
    const { applyPulledItem } = await import("../syncClient.js");
    expect(() =>
      applyPulledItem({
        kind: "notes",
        key: "abc",
        payload: {},
        deleted: false,
        updatedAt: "2026-01-01T00:00:00Z",
      }),
    ).not.toThrow();
  });
});
