import { beforeEach, describe, expect, it, vi } from "vitest";

const restoreFocusContext = vi.fn();
const resolveTypingFocusTarget = vi.fn();
const sendKeyChord = vi.fn();
const selectAll = vi.fn();
const ensureBrowserComposerFocus = vi.fn();
const getFocusedA11yElement = vi.fn();
const readText = vi.fn();
const writeText = vi.fn();

vi.mock("../../../focus/focusContext.js", () => ({
  restoreFocusContext: (...args: unknown[]) => restoreFocusContext(...args),
  resolveTypingFocusTarget: (...args: unknown[]) => resolveTypingFocusTarget(...args),
}));

vi.mock("../../../automation/delay.js", () => ({
  delay: vi.fn(async () => undefined),
}));

vi.mock("../../../automation/keyboard.js", () => ({
  sendKeyChord: (...args: unknown[]) => sendKeyChord(...args),
  selectAll: (...args: unknown[]) => selectAll(...args),
}));

vi.mock("../../../native/win32Bridge.js", () => ({
  getFocusedA11yElement: (...args: unknown[]) => getFocusedA11yElement(...args),
}));

vi.mock("../../editorFocus.js", () => ({
  ensureBrowserComposerFocus: (...args: unknown[]) =>
    ensureBrowserComposerFocus(...args),
  isBrowserProcess: (p: string) => p.toLowerCase() === "chrome",
}));

vi.mock("electron", () => ({
  clipboard: {
    readText: (...args: unknown[]) => readText(...args),
    writeText: (...args: unknown[]) => writeText(...args),
  },
}));

const { readSelectedText } = await import("../selectionCapture.js");

describe("readSelectedText", () => {
  beforeEach(() => {
    restoreFocusContext.mockReset();
    resolveTypingFocusTarget.mockReset();
    sendKeyChord.mockReset();
    selectAll.mockReset();
    ensureBrowserComposerFocus.mockReset();
    getFocusedA11yElement.mockReset();
    readText.mockReset();
    writeText.mockReset();

    restoreFocusContext.mockResolvedValue(true);
    resolveTypingFocusTarget.mockReturnValue({
      processName: "chrome",
      isBrowser: true,
      isWhatsApp: true,
    });
    sendKeyChord.mockResolvedValue(undefined);
    selectAll.mockResolvedValue(undefined);
    ensureBrowserComposerFocus.mockResolvedValue(true);
    getFocusedA11yElement.mockResolvedValue({
      controlType: "ControlType.Edit",
      name: "Type a message",
    });
    readText.mockReturnValue("");
  });

  it("does not Ctrl+C when focus restore failed (explorer FG)", async () => {
    restoreFocusContext.mockResolvedValue(false);
    const got = await readSelectedText();
    expect(got).toBeNull();
    expect(sendKeyChord).not.toHaveBeenCalled();
  });

  it("captures a highlighted selection on first Ctrl+C", async () => {
    let n = 0;
    readText.mockImplementation(() => {
      n += 1;
      if (n === 1) return "saved-clip";
      return "Hello, I miss you";
    });
    const got = await readSelectedText();
    expect(got).toBe("Hello, I miss you");
    expect(selectAll).not.toHaveBeenCalled();
  });

  it("falls back to composer select-all when WhatsApp draft is unselected", async () => {
    let n = 0;
    readText.mockImplementation(() => {
      n += 1;
      if (n === 1) return "saved-clip";
      if (n === 2) return "__ripple_no_selection_1__";
      return "Hello, I'm missing you so much.";
    });
    const got = await readSelectedText();
    expect(got).toBe("Hello, I'm missing you so much.");
    expect(ensureBrowserComposerFocus).toHaveBeenCalled();
    expect(selectAll).toHaveBeenCalled();
  });
});
