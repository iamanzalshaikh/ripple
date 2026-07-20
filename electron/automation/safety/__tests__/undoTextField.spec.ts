import { describe, expect, it, vi } from "vitest";

const clipboardStore = { value: "" };

vi.mock("electron", () => ({
  clipboard: {
    readText: () => clipboardStore.value,
    writeText: (v: string) => {
      clipboardStore.value = v;
    },
  },
}));

vi.mock("../../../focus/focusContext.js", () => ({
  restoreFocusContext: vi.fn(async () => undefined),
}));

vi.mock("../keyboard.js", () => ({
  selectAll: vi.fn(async () => undefined),
  pasteFromClipboard: vi.fn(async () => undefined),
}));

describe("reverseUndoAction — restore_text_field", () => {
  it("pastes the previous text back and restores the prior clipboard", async () => {
    clipboardStore.value = "whatever was on the clipboard before";
    const { reverseUndoAction } = await import("../undoRunner.js");

    const result = await reverseUndoAction({
      kind: "restore_text_field",
      previousText: "Read the contract I sent you.",
      surface: "whatsapp",
    });

    expect(result).toContain("whatsapp");
    // Clipboard must end up back where it started (no pollution).
    expect(clipboardStore.value).toBe("whatever was on the clipboard before");
  });
});
