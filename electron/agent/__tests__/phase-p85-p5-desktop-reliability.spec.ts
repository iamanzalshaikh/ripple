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
  ensureInsertForeground: vi.fn(async () => true),
  matchesPinnedInsertTarget: vi.fn(
    (
      fg: { processName?: string },
      pinned: { processName?: string },
    ) =>
      (fg.processName ?? "").toLowerCase() ===
      (pinned.processName ?? "").toLowerCase(),
  ),
}));

vi.mock("../../agent/editorFocus.js", () => ({
  ensureEditorKeyboardFocus: vi.fn(async () => undefined),
}));

const {
  runInputSequenceNative,
  screenshotOcrNative,
  mouseClickNative,
  getWindowRectCenter,
  verifyTypingObservation,
  getForegroundWindow,
  getInsertTextA11yDiagnostics,
} = vi.hoisted(() => ({
  runInputSequenceNative: vi.fn(),
  screenshotOcrNative: vi.fn(),
  mouseClickNative: vi.fn(),
  getWindowRectCenter: vi.fn(),
  verifyTypingObservation: vi.fn(),
  getForegroundWindow: vi.fn((..._args: unknown[]) =>
    Promise.resolve({ hwnd: 1, processName: "notepad", windowTitle: "Notepad" }),
  ),
  getInsertTextA11yDiagnostics: vi.fn(async () => ({
    focused: { value: "" },
  })),
}));

vi.mock("../../native/win32Bridge.js", () => ({
  runInputSequenceNative: (...args: unknown[]) => runInputSequenceNative(...args),
  screenshotOcrNative: (...args: unknown[]) => screenshotOcrNative(...args),
  mouseClickNative: (...args: unknown[]) => mouseClickNative(...args),
  getWindowRectCenter: (...args: unknown[]) => getWindowRectCenter(...args),
  getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
  getInsertTextA11yDiagnostics: (...args: unknown[]) =>
    getInsertTextA11yDiagnostics(...args),
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
    getInsertTextA11yDiagnostics.mockResolvedValue({ focused: { value: "" } });
  });

  it("uses sendkeys when native text fails", async () => {
    const { strategy } = await runInsertWithFallback("hello");
    expect(strategy).toBe("sendkeys");
  });

  it("does not retype via sendkeys when native failed but field already has text", async () => {
    const { simulateTyping } = await import("../../automation/keyboard.js");
    runInputSequenceNative.mockResolvedValue({ ok: false });
    getInsertTextA11yDiagnostics.mockResolvedValue({
      focused: { value: "Good afternoon, how are you?" },
    });
    const { strategy } = await runInsertWithFallback(
      "Good afternoon, how are you?",
    );
    expect(strategy).toBe("native_text");
    expect(simulateTyping).not.toHaveBeenCalled();
  });

  it("does not false-accept already-has-text when focus is Chrome omnibox", async () => {
    const { simulateTyping } = await import("../../automation/keyboard.js");
    runInputSequenceNative.mockResolvedValue({ ok: false });
    getInsertTextA11yDiagnostics.mockResolvedValue({
      focused: {
        name: "Address and search bar",
        className: "OmniboxViewViews",
        value: "localhost:3000/agent/payment/abc",
      },
    });
    const { strategy } = await runInsertWithFallback(
      "I want to know why this error is happening because I want production",
    );
    // Must fall through ladder (sendkeys), not claim native_text success.
    expect(strategy).not.toBe("native_text");
    expect(simulateTyping).toHaveBeenCalled();
  });

  it("does not false-accept already-has-text when FG ≠ pinned target", async () => {
    const { simulateTyping } = await import("../../automation/keyboard.js");
    runInputSequenceNative.mockResolvedValue({ ok: false });
    getForegroundWindow.mockResolvedValueOnce({
      hwnd: 99,
      processName: "chrome",
      windowTitle: "localhost - Google Chrome",
    });
    getInsertTextA11yDiagnostics.mockResolvedValue({
      focused: {
        value:
          "I want to know why this error is happening because I want production",
      },
    });
    const { strategy } = await runInsertWithFallback(
      "I want to know why this error is happening because I want production",
    );
    expect(strategy).not.toBe("native_text");
    expect(simulateTyping).toHaveBeenCalled();
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

  it("aborts (not false success) when verify fails for an unaccepted reason, without ladder retry", async () => {
    runInputSequenceNative.mockResolvedValue({ ok: true });
    verifyTypingObservation.mockResolvedValueOnce({
      ok: false,
      reason: "a11y_name_mismatch",
      before: {},
      after: {},
    });
    const { simulateTyping } = await import("../../automation/keyboard.js");
    // Q1 fix: without acceptUnverifiableEdit and without editable-control
    // evidence, a verify failure must surface as a real failure — not a
    // silently-returned "status=ok". Real-world equivalent:
    // focus_not_editable:ControlType.Pane (text landed on the Windows
    // shell/search flyout, not the target app) used to be reported as
    // INSERT_TEXT OK.
    await expect(
      runInsertWithFallback("verified text", { verify: true }),
    ).rejects.toThrow(/insert_aborted:verify_failed:a11y_name_mismatch/);
    expect(simulateTyping).not.toHaveBeenCalled();
    expect(verifyTypingObservation).toHaveBeenCalledTimes(1);
  });

  it("accepts same-app foreground churn after committed insert without ladder retry", async () => {
    runInputSequenceNative.mockResolvedValue({ ok: true });
    verifyTypingObservation.mockResolvedValueOnce({
      ok: false,
      reason: "foreground_changed",
      before: { foreground: { processName: "notepad", hwnd: 1 } },
      after: { foreground: { processName: "notepad", hwnd: 2 } },
    });
    const { simulateTyping } = await import("../../automation/keyboard.js");
    const { strategy } = await runInsertWithFallback("same app hwnd swap", {
      verify: true,
    });
    expect(strategy).toBe("native_text");
    expect(simulateTyping).not.toHaveBeenCalled();
  });

  it("aborts on cross-app foreground_changed instead of accepting blindly", async () => {
    runInputSequenceNative.mockResolvedValue({ ok: true });
    verifyTypingObservation.mockResolvedValueOnce({
      ok: false,
      reason: "foreground_changed",
      before: { foreground: { processName: "chatgpt classic", hwnd: 1 } },
      after: { foreground: { processName: "cursor", hwnd: 2 } },
    });
    const { simulateTyping } = await import("../../automation/keyboard.js");
    // Q1 fix: unlike the old code, a bare foreground_changed reason is no
    // longer accepted unconditionally — only same-app hwnd churn is. A real
    // cross-app steal (ChatGPT → Cursor) must abort, not report success.
    await expect(
      runInsertWithFallback("stolen focus text", { verify: true }),
    ).rejects.toThrow(/insert_aborted:verify_failed:foreground_changed/);
    expect(simulateTyping).not.toHaveBeenCalled();
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

  describe("Q2/Q4 — long text gets mid-send foreground checkpoints", () => {
    const longText =
      "This is a long dictation that goes well past the one hundred character " +
      "checkpoint threshold so it should be sent in multiple native chunks.";

    it("sends long text in multiple chunks and checks foreground between them", async () => {
      runInputSequenceNative.mockResolvedValue({ ok: true });
      getForegroundWindow.mockResolvedValue({
        hwnd: 1,
        processName: "notepad",
        windowTitle: "Notepad",
      });
      const { strategy } = await runInsertWithFallback(longText);
      expect(strategy).toBe("native_text");
      expect(runInputSequenceNative.mock.calls.length).toBeGreaterThan(1);
      expect(getForegroundWindow).toHaveBeenCalled();
    });

    it("aborts cleanly (not a silent partial or a re-typed duplicate) when foreground changes mid-send", async () => {
      runInputSequenceNative.mockResolvedValue({ ok: true });
      const { simulateTyping } = await import("../../automation/keyboard.js");
      // First chunk lands while Notepad still has focus; before the second
      // chunk we detect the hwnd changed (shell/search flyout stole it).
      getForegroundWindow
        .mockResolvedValueOnce({
          hwnd: 1,
          processName: "notepad",
          windowTitle: "Notepad",
        })
        .mockResolvedValue({
          hwnd: 999,
          processName: "explorer",
          windowTitle: "",
        });
      await expect(runInsertWithFallback(longText)).rejects.toThrow(
        /insert_aborted:foreground_changed_mid_send:sentChars=\d+:total=\d+/,
      );
      // Must not fall through to sendkeys and re-type the whole string on
      // top of whatever already landed in the original window.
      expect(simulateTyping).not.toHaveBeenCalled();
    });
  });
});
