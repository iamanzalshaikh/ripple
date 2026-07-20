import { describe, expect, it, vi, beforeEach } from "vitest";
import { runInsertWithFallback } from "../../automation/input/inputStrategy.js";

vi.mock("../../automation/keyboard.js", () => ({
  simulateTyping: vi.fn(async () => undefined),
  selectAll: vi.fn(async () => undefined),
  pasteFromClipboard: vi.fn(async () => undefined),
}));

vi.mock("../../focus/focusContext.js", () => ({
  getFocusContext: () => ({ processName: "notepad" }),
  restoreFocusContext: vi.fn(async () => undefined),
  resolveTypingFocusTarget: () => ({
    hwnd: 1,
    windowTitle: "Notepad",
    processName: "notepad",
  }),
}));

vi.mock("../../agent/editorFocus.js", () => ({
  ensureEditorKeyboardFocus: vi.fn(async () => undefined),
}));

const runInputSequenceNative = vi.fn();
const screenshotOcrNative = vi.fn();
const mouseClickNative = vi.fn();
const getWindowRectCenter = vi.fn();
const verifyTypingObservation = vi.fn();

vi.mock("../../native/win32Bridge.js", () => ({
  runInputSequenceNative: (...args: unknown[]) => runInputSequenceNative(...args),
  screenshotOcrNative: (...args: unknown[]) => screenshotOcrNative(...args),
  mouseClickNative: (...args: unknown[]) => mouseClickNative(...args),
  getWindowRectCenter: (...args: unknown[]) => getWindowRectCenter(...args),
}));

vi.mock("../../agent/observe.js", () => ({
  captureObservation: vi.fn(async () => ({
    foreground: { hwnd: 1, processName: "notepad", windowTitle: "x" },
    focusedA11y: null,
    timestamp: Date.now(),
  })),
  verifyTypingObservation: (...args: unknown[]) => verifyTypingObservation(...args),
}));

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
}));

describe("P8.5-P5.2 insert strategy ladder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RIPPLE_P85_VISION_INSERT = "1";
    runInputSequenceNative.mockResolvedValue({ ok: false });
    screenshotOcrNative.mockResolvedValue({
      text: "",
      width: 100,
      height: 100,
      lineCount: 0,
    });
    getWindowRectCenter.mockResolvedValue({ x: 100, y: 100 });
    mouseClickNative.mockResolvedValue({ ok: false });
    verifyTypingObservation.mockResolvedValue({ ok: true, before: {}, after: {} });
  });

  it("uses sendkeys when native text fails", async () => {
    const { strategy } = await runInsertWithFallback("hello");
    expect(strategy).toBe("sendkeys");
  });

  it("falls back to clipboard paste when sendkeys fails", async () => {
    const { selectAll, simulateTyping } = await import(
      "../../automation/keyboard.js"
    );
    vi.mocked(simulateTyping).mockRejectedValueOnce(new Error("sendkeys fail"));
    const { strategy } = await runInsertWithFallback("hello world");
    expect(strategy).toBe("clipboard_paste");
    expect(selectAll).not.toHaveBeenCalled();
  });

  it("selects all before clipboard paste only for explicit replacement", async () => {
    const { selectAll, simulateTyping } = await import(
      "../../automation/keyboard.js"
    );
    vi.mocked(simulateTyping).mockRejectedValueOnce(new Error("sendkeys fail"));
    const { strategy } = await runInsertWithFallback("replacement", {
      replaceAll: true,
    });
    expect(strategy).toBe("clipboard_paste");
    expect(selectAll).toHaveBeenCalledTimes(1);
  });

  it("uses vision only after native, sendkeys, and clipboard fail", async () => {
    const { simulateTyping, pasteFromClipboard } = await import(
      "../../automation/keyboard.js"
    );
    vi.mocked(simulateTyping).mockRejectedValueOnce(new Error("sendkeys fail"));
    vi.mocked(pasteFromClipboard).mockRejectedValueOnce(new Error("paste fail"));
    getWindowRectCenter.mockResolvedValue({ x: 100, y: 100 });
    mouseClickNative.mockResolvedValue({ ok: true });
    const { strategy } = await runInsertWithFallback("hello vision");
    expect(strategy).toBe("vision");
    expect(mouseClickNative).toHaveBeenCalled();
  });

  it("retries next strategy when verify fails", async () => {
    runInputSequenceNative.mockResolvedValue({ ok: true });
    verifyTypingObservation
      .mockResolvedValueOnce({ ok: false, reason: "a11y_name_mismatch" })
      .mockResolvedValueOnce({ ok: true, before: {}, after: {} });
    const { strategy } = await runInsertWithFallback("verified text", {
      verify: true,
    });
    expect(strategy).toBe("sendkeys");
    expect(verifyTypingObservation).toHaveBeenCalledTimes(2);
  });

  it("accepts unverifiable editable insert without duplicating via retry", async () => {
    const { simulateTyping } = await import("../../automation/keyboard.js");
    runInputSequenceNative.mockResolvedValue({ ok: true });
    verifyTypingObservation.mockResolvedValueOnce({
      ok: false,
      reason: "a11y_name_mismatch",
      before: {},
      after: {
        focusedA11y: { controlType: "ControlType.Edit" },
      },
    });

    const { strategy } = await runInsertWithFallback("web compose text", {
      verify: true,
      acceptUnverifiableEdit: true,
    });

    expect(strategy).toBe("native_text");
    expect(simulateTyping).not.toHaveBeenCalled();
  });
});
