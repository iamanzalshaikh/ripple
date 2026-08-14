import { beforeEach, describe, expect, it, vi } from "vitest";

let clipboardValue = "";
vi.mock("electron", () => ({
  clipboard: {
    writeText: vi.fn((t: string) => {
      clipboardValue = t;
    }),
    readText: vi.fn(() => clipboardValue),
  },
}));

const pasteFromClipboard = vi.fn(async () => undefined);
vi.mock("../../keyboard.js", () => ({
  pasteFromClipboard: (...a: unknown[]) => pasteFromClipboard(...a),
  selectAll: vi.fn(async () => undefined),
  simulateTyping: vi.fn(async () => undefined),
}));

const ensureBrowserComposerFocus = vi.fn(async () => true);
vi.mock("../../../agent/editorFocus.js", () => ({
  ensureEditorKeyboardFocus: vi.fn(async () => undefined),
  ensureBrowserComposerFocus: (...a: unknown[]) =>
    ensureBrowserComposerFocus(...a),
}));

vi.mock("../../../focus/focusContext.js", () => ({
  ensureInsertForeground: vi.fn(async () => true),
  getFocusContext: () => ({
    hwnd: 777,
    processName: "chrome",
    windowTitle: "Claude - Google Chrome",
    isBrowser: true,
  }),
  matchesPinnedInsertTarget: () => true,
  resolveTypingFocusTarget: () => ({
    hwnd: 777,
    processName: "chrome",
    windowTitle: "Claude - Google Chrome",
    isBrowser: true,
  }),
}));

vi.mock("../../../native/win32Bridge.js", () => ({
  getForegroundWindow: vi.fn(async () => ({
    hwnd: 777,
    processName: "chrome",
    windowTitle: "Claude - Google Chrome",
  })),
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

const verifyTypingObservation = vi.fn();
const captureObservation = vi.fn(async () => ({
  foreground: { hwnd: 777, processName: "chrome", windowTitle: "Claude" },
  focusedA11y: null,
  timestamp: Date.now(),
}));
vi.mock("../../../agent/observe.js", () => ({
  captureObservation: (...a: unknown[]) => captureObservation(...a),
  verifyTypingObservation: (...a: unknown[]) => verifyTypingObservation(...a),
}));

function obs(value: string) {
  return {
    foreground: { hwnd: 777, processName: "chrome", windowTitle: "Claude" },
    focusedA11y: {
      name: "Write your prompt to Claude",
      controlType: "ControlType.Edit",
      automationId: "",
      className: "",
      value,
    },
    timestamp: Date.now(),
  };
}

function mismatch(valueBefore: string, valueAfter: string) {
  return {
    ok: false,
    reason: "a11y_name_mismatch",
    before: obs(valueBefore),
    after: obs(valueAfter),
  };
}

const OPTIONS = {
  verify: true,
  preferFirst: "clipboard_paste" as const,
  acceptUnverifiableEdit: true,
  includeVision: false,
  abortLadderOnPartialNativeFail: true,
};

describe("paste-landing value-change acceptance rule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    clipboardValue = "";
  });

  it("byte-identical readable value → one retry after composer click → abort paste_no_effect", async () => {
    const placeholder = "write your prompt to claude";
    verifyTypingObservation.mockResolvedValue(mismatch(placeholder, placeholder));
    const { runInsertWithFallback } = await import("../inputStrategy.js");

    await expect(
      runInsertWithFallback("hello from dictation", {
        ...OPTIONS,
        beforeObserve: obs(placeholder),
      }),
    ).rejects.toThrow(/insert_aborted:paste_no_effect/);

    // exactly one retry: two paste sends total, with an explicit composer click between
    expect(pasteFromClipboard).toHaveBeenCalledTimes(2);
    expect(ensureBrowserComposerFocus).toHaveBeenCalled();
  });

  it("value changed → accepted without retry", async () => {
    verifyTypingObservation.mockResolvedValue(
      mismatch("placeholder text", "placeholder text hello from dictation"),
    );
    const { runInsertWithFallback } = await import("../inputStrategy.js");
    const res = await runInsertWithFallback("hello from dictation", {
      ...OPTIONS,
      beforeObserve: obs("placeholder text"),
    });
    expect(res.strategy).toBe("clipboard_paste");
    expect(pasteFromClipboard).toHaveBeenCalledTimes(1);
  });

  it("late landing on the retry → accepted, no second retry (no double insert)", async () => {
    const placeholder = "write your prompt";
    let call = 0;
    verifyTypingObservation.mockImplementation(async () => {
      call += 1;
      // first verify: identical; retry verify: text landed
      return call === 1
        ? mismatch(placeholder, placeholder)
        : mismatch(placeholder, `${placeholder} hello from dictation`);
    });
    const { runInsertWithFallback } = await import("../inputStrategy.js");
    const res = await runInsertWithFallback("hello from dictation", {
      ...OPTIONS,
      beforeObserve: obs(placeholder),
    });
    expect(res.strategy).toBe("clipboard_paste");
    expect(pasteFromClipboard).toHaveBeenCalledTimes(2);
  });

  it("control exposes no value at all (WhatsApp contenteditable) → accepted, no retry", async () => {
    verifyTypingObservation.mockResolvedValue(mismatch("", ""));
    const { runInsertWithFallback } = await import("../inputStrategy.js");
    const res = await runInsertWithFallback("hello from dictation", {
      ...OPTIONS,
      beforeObserve: obs(""),
    });
    expect(res.strategy).toBe("clipboard_paste");
    expect(pasteFromClipboard).toHaveBeenCalledTimes(1);
  });

  it("fragment of dictated text present in value → accepted even if value lengths match", async () => {
    verifyTypingObservation.mockResolvedValue(
      mismatch("hello from dictationXX", "hello from dictation.."),
    );
    const { runInsertWithFallback } = await import("../inputStrategy.js");
    const res = await runInsertWithFallback("hello from dictation", {
      ...OPTIONS,
      beforeObserve: obs(""),
    });
    expect(res.strategy).toBe("clipboard_paste");
    expect(pasteFromClipboard).toHaveBeenCalledTimes(1);
  });
});
