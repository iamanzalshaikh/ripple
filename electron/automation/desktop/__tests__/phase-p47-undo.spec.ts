import { describe, expect, it } from "vitest";
import { parseUndoCommand } from "../parseUndoCommand.js";

describe("parseUndoCommand", () => {
  it("parses English undo", () => {
    expect(parseUndoCommand("undo last action")).toEqual({ kind: "undo_last" });
    expect(parseUndoCommand("Undo")).toEqual({ kind: "undo_last" });
  });

  it("parses Hinglish wapas karo", () => {
    expect(parseUndoCommand("wapas karo")).toEqual({ kind: "undo_last" });
    expect(parseUndoCommand("Undo kar do")).toEqual({ kind: "undo_last" });
  });
});
