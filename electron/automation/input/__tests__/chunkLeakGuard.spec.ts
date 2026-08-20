import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Row 3.8 — long dictation must not leak characters into the wrong window.
 *
 * Live 2026-08-20: "native checkpoint chunk 3/5 failed; sentChars=111/250" —
 * 111 characters had already landed in an Instagram message box because the
 * foreground check only ran BETWEEN chunks, never before the first one.
 */

const getForegroundWindow = vi.fn();
const runInputSequenceNative = vi.fn();

vi.mock("../../../native/win32Bridge.js", () => ({
  getForegroundWindow: (...a: unknown[]) => getForegroundWindow(...a),
  runInputSequenceNative: (...a: unknown[]) => runInputSequenceNative(...a),
  getInsertTextA11yDiagnostics: vi.fn(async () => null),
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

vi.mock("../insertGates.js", () => ({
  assertPreSendGates: vi.fn(async () => undefined),
}));

vi.mock("../visionInsert.js", () => ({
  runVisionInsert: vi.fn(async () => false),
  visionInsertEnabled: () => false,
}));

vi.mock("../../keyboard.js", () => ({
  pasteFromClipboard: vi.fn(async () => undefined),
  selectAll: vi.fn(async () => undefined),
  simulateTyping: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn(), readText: vi.fn(() => "") },
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

// 250 chars — same length as the live failure, forces the chunked path.
const LONG_TEXT = "word ".repeat(50).trim();

describe("Row 3.8 — chunked send must not leak into the wrong window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runInputSequenceNative.mockResolvedValue({ ok: true });
  });

  it("sends ZERO chunks when the foreground is already wrong", async () => {
    // Another window owns the foreground from the very start.
    getForegroundWindow.mockResolvedValue({
      hwnd: 999,
      processName: "chrome",
      windowTitle: "Instagram",
    });

    const { runInsertWithFallback } = await import("../inputStrategy.js");
    await expect(
      runInsertWithFallback(LONG_TEXT, {
        verify: false,
        abortLadderOnPartialNativeFail: true,
      }),
    ).rejects.toThrow(/insert_aborted:foreground_changed_mid_send:sentChars=0/);

    // The critical assertion: nothing was typed anywhere.
    expect(runInputSequenceNative).not.toHaveBeenCalled();
  });

  it("stops at the chunk boundary when focus changes mid-send", async () => {
    // Key off chunks actually SENT, so the assertion does not depend on how
    // many times getForegroundWindow happens to be consulted elsewhere.
    getForegroundWindow.mockImplementation(async () =>
      runInputSequenceNative.mock.calls.length < 2
        ? { hwnd: 111, processName: "chrome", windowTitle: "WhatsApp" }
        : { hwnd: 999, processName: "chrome", windowTitle: "Instagram" },
    );

    const { runInsertWithFallback } = await import("../inputStrategy.js");
    await expect(
      runInsertWithFallback(LONG_TEXT, {
        verify: false,
        abortLadderOnPartialNativeFail: true,
      }),
    ).rejects.toThrow(/insert_aborted:foreground_changed_mid_send/);

    // Stopped as soon as focus moved — did NOT push the remaining chunks.
    expect(runInputSequenceNative.mock.calls.length).toBe(2);
    // 250 chars / 60 = 5 chunks; proving it aborted well short of the end.
    expect(runInputSequenceNative.mock.calls.length).toBeLessThan(5);
  });

  it("sends every chunk when the foreground stays correct", async () => {
    getForegroundWindow.mockResolvedValue({
      hwnd: 111,
      processName: "chrome",
      windowTitle: "WhatsApp",
    });

    const { runInsertWithFallback } = await import("../inputStrategy.js");
    const res = await runInsertWithFallback(LONG_TEXT, { verify: false });

    expect(res.strategy).toBe("native_text");
    expect(runInputSequenceNative.mock.calls.length).toBeGreaterThan(1);
  });

  // Row 3.7 — a long dictation must deliver EVERY character, not a truncation.
  it("delivers 100% of a 500+ char dictation with no loss or duplication", async () => {
    getForegroundWindow.mockResolvedValue({
      hwnd: 111,
      processName: "chrome",
      windowTitle: "WhatsApp",
    });
    const longText =
      "the quick brown fox jumps over the lazy dog and then keeps running ".repeat(
        8,
      ) + "end";
    expect(longText.length).toBeGreaterThan(500);

    const { runInsertWithFallback } = await import("../inputStrategy.js");
    const res = await runInsertWithFallback(longText, { verify: false });
    expect(res.strategy).toBe("native_text");

    // Reassemble exactly what was pushed to the OS.
    const sent = runInputSequenceNative.mock.calls
      .map((c) => {
        const steps = (c[0] as { steps?: Array<{ value: string }> })?.steps ?? [];
        return steps.map((s) => s.value).join("");
      })
      .join("");

    expect(sent).toBe(longText);
    expect(sent.length).toBe(longText.length);
  });
});
