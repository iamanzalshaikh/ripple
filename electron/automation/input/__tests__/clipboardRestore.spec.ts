import { beforeEach, describe, expect, it, vi } from "vitest";


/**
 * Row 3.14 — dictation must not destroy the user's clipboard.
 *
 * The clipboard_paste strategy overwrites the clipboard to paste. Whatever the
 * user had copied has to be handed back once the paste has landed.
 */

let clipboardValue = "";
const writeText = vi.fn((t: string) => {
  clipboardValue = t;
});
const readText = vi.fn(() => clipboardValue);

vi.mock("electron", () => ({
  clipboard: {
    writeText: (t: string) => writeText(t),
    readText: () => readText(),
  },
}));

const pasteFromClipboard = vi.fn(async (): Promise<void> => undefined);
vi.mock("../../keyboard.js", () => ({
  pasteFromClipboard: () => pasteFromClipboard(),
  selectAll: vi.fn(async () => undefined),
  simulateTyping: vi.fn(async () => undefined),
}));

const PIN = {
  hwnd: 111,
  processName: "chrome",
  windowTitle: "WhatsApp",
  isBrowser: true,
};

vi.mock("../../../focus/focusContext.js", () => ({
  ensureInsertForeground: vi.fn(async () => true),
  getFocusContext: () => PIN,
  matchesPinnedInsertTarget: () => true,
  resolveTypingFocusTarget: () => PIN,
}));

vi.mock("../../../native/win32Bridge.js", () => ({
  getForegroundWindow: vi.fn(async () => PIN),
  runInputSequenceNative: vi.fn(async () => ({ ok: true })),
  getInsertTextA11yDiagnostics: vi.fn(async () => null),
}));

vi.mock("../insertGates.js", () => ({
  assertPreSendGates: vi.fn(async () => undefined),
}));

vi.mock("../visionInsert.js", () => ({
  runVisionInsert: vi.fn(async () => false),
  visionInsertEnabled: () => false,
}));

vi.mock("../../../agent/editorFocus.js", () => ({
  ensureEditorKeyboardFocus: vi.fn(async () => undefined),
  ensureBrowserComposerFocus: vi.fn(async () => true),
}));

vi.mock("../../../agent/observe.js", () => ({
  captureObservation: vi.fn(async () => ({
    foreground: PIN,
    focusedA11y: null,
    timestamp: Date.now(),
  })),
  verifyTypingObservation: vi.fn(async () => ({ ok: true })),
}));

describe("Row 3.14 — clipboard is preserved across a paste insert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    clipboardValue = "";
  });

  it("restores the user's original clipboard after pasting", async () => {
    clipboardValue = "IMPORTANT bank details the user copied";

    const { runInsertWithFallback, flushClipboardRestoreForTests } =
      await import("../inputStrategy.js");
    const res = await runInsertWithFallback("dictated sentence", {
      verify: false,
      preferFirst: "clipboard_paste",
    });

    flushClipboardRestoreForTests();
    expect(res.strategy).toBe("clipboard_paste");
    expect(pasteFromClipboard).toHaveBeenCalled();
    // The paste happened, and the user's content is back.
    expect(clipboardValue).toBe("IMPORTANT bank details the user copied");
  });

  it("pastes the dictated text before restoring (order matters)", async () => {
    clipboardValue = "original";
    let clipboardAtPasteTime: string | null = null;
    pasteFromClipboard.mockImplementation(async () => {
      clipboardAtPasteTime = clipboardValue;
    });

    const { runInsertWithFallback, flushClipboardRestoreForTests } =
      await import("../inputStrategy.js");
    await runInsertWithFallback("dictated sentence", {
      verify: false,
      preferFirst: "clipboard_paste",
    });

    flushClipboardRestoreForTests();
    // At the moment Ctrl+V fired, the dictated text was on the clipboard…
    expect(clipboardAtPasteTime).toBe("dictated sentence");
    // …and afterwards the original was put back.
    expect(clipboardValue).toBe("original");
  });

  it("restores an empty clipboard faithfully (user had nothing copied)", async () => {
    clipboardValue = "";
    let clipboardAtPasteTime: string | null = null;
    pasteFromClipboard.mockImplementation(async () => {
      clipboardAtPasteTime = clipboardValue;
    });

    const { runInsertWithFallback, flushClipboardRestoreForTests } =
      await import("../inputStrategy.js");
    await runInsertWithFallback("dictated sentence", {
      verify: false,
      preferFirst: "clipboard_paste",
    });

    flushClipboardRestoreForTests();
    // Paste still used the dictated text…
    expect(clipboardAtPasteTime).toBe("dictated sentence");
    // …then the clipboard went back to exactly what the user had: nothing.
    expect(clipboardValue).toBe("");
  });

  // Live 2026-08-20: `clipboard_restored len=0` inside a 4082 ms compose→paste —
  // dictation was spending 700 ms of the user's stop→paste budget waiting to
  // restore an EMPTY clipboard. The hand-back still happens, just not on the
  // critical path.
  it("does NOT make the user wait for the restore", async () => {
    clipboardValue = "user content";

    const { runInsertWithFallback, flushClipboardRestoreForTests } =
      await import("../inputStrategy.js");
    await runInsertWithFallback("dictated sentence", {
      verify: false,
      preferFirst: "clipboard_paste",
    });

    // The insert returned with the restore STILL OUTSTANDING — that is the
    // whole point, and asserting it by state rather than by elapsed time keeps
    // the test honest under parallel load.
    expect(clipboardValue).toBe("dictated sentence");

    // And it still lands once it fires.
    flushClipboardRestoreForTests();
    expect(clipboardValue).toBe("user content");
  });

  it("a later insert is never clobbered by an earlier pending restore", async () => {
    clipboardValue = "first original";

    const { runInsertWithFallback, flushClipboardRestoreForTests } =
      await import("../inputStrategy.js");

    await runInsertWithFallback("first dictation", {
      verify: false,
      preferFirst: "clipboard_paste",
    });
    // Second insert lands before the first restore fires.
    await runInsertWithFallback("second dictation", {
      verify: false,
      preferFirst: "clipboard_paste",
    });

    flushClipboardRestoreForTests();

    // The superseded restore must not resurrect the first insert's snapshot.
    expect(clipboardValue).not.toBe("first original");
  });
});
