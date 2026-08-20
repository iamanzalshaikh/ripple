import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Row 1.9 — pressing the hotkey again while a previous insert is still
 * in-flight. A long dictation is sent in 60-char chunks over several hundred
 * ms, so a second (short) dictation can finish and start inserting before the
 * first one is done. If the two runs interleave, the user gets two sentences
 * shredded into each other at chunk boundaries.
 *
 * This spec measures the real behaviour rather than assuming it.
 */

const getForegroundWindow = vi.fn();
const runInputSequenceNative = vi.fn();

vi.mock("../../../native/win32Bridge.js", () => ({
  getForegroundWindow: () => getForegroundWindow(),
  runInputSequenceNative: (arg: unknown) => runInputSequenceNative(arg),
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

/** Reconstruct the exact character stream handed to the OS, in real order. */
function sentStream(): string {
  return runInputSequenceNative.mock.calls
    .map((c) => {
      const steps = (c[0] as { steps?: Array<{ value: string }> })?.steps ?? [];
      return steps.map((s) => s.value).join("");
    })
    .join("");
}

describe("Row 1.9 — second press while an insert is in-flight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getForegroundWindow.mockResolvedValue({
      hwnd: 111,
      processName: "chrome",
      windowTitle: "WhatsApp",
    });
    // Each chunk takes real time, which is what opens the interleave window.
    runInputSequenceNative.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true }), 5),
        ),
    );
  });

  it("two overlapping inserts do not interleave their characters", async () => {
    const { runInsertWithFallback } = await import("../inputStrategy.js");

    const first = "A".repeat(300);
    const second = "B".repeat(120);

    // Fire the second insert while the first is mid-chunk.
    const p1 = runInsertWithFallback(first, { verify: false });
    await new Promise((r) => setTimeout(r, 12));
    const p2 = runInsertWithFallback(second, { verify: false });

    await Promise.all([p1, p2]);

    const stream = sentStream();

    // Every character must arrive, from both dictations.
    expect(stream.length).toBe(first.length + second.length);
    expect((stream.match(/A/g) ?? []).length).toBe(first.length);
    expect((stream.match(/B/g) ?? []).length).toBe(second.length);

    // The decisive assertion: each dictation must land as ONE contiguous run.
    // Interleaving shows up as more than two runs (AAA BBB AAA ...).
    const runs = stream.match(/A+|B+/g) ?? [];
    expect(runs.length).toBe(2);
  });

  it("serializing preserves order: the first press lands first", async () => {
    const { runInsertWithFallback } = await import("../inputStrategy.js");

    const p1 = runInsertWithFallback("A".repeat(300), { verify: false });
    await new Promise((r) => setTimeout(r, 12));
    const p2 = runInsertWithFallback("B".repeat(120), { verify: false });
    await Promise.all([p1, p2]);

    expect(sentStream().startsWith("A")).toBe(true);
  });

  it("a failing insert still releases the queue for the next one", async () => {
    const { runInsertWithFallback } = await import("../inputStrategy.js");

    // First insert blows up mid-flight.
    runInputSequenceNative.mockRejectedValueOnce(new Error("sidecar_died"));
    await runInsertWithFallback("A".repeat(300), { verify: false }).catch(
      () => undefined,
    );

    // The next dictation must not be stuck behind the dead one.
    runInputSequenceNative.mockImplementation(async () => ({ ok: true }));
    const res = await runInsertWithFallback("recovered text", {
      verify: false,
    });
    expect(res.strategy).toBeTruthy();
    expect(sentStream()).toContain("recovered text");
  });

  it("a single insert is not delayed by the queue", async () => {
    const { runInsertWithFallback } = await import("../inputStrategy.js");
    runInputSequenceNative.mockImplementation(async () => ({ ok: true }));

    const started = Date.now();
    await runInsertWithFallback("short", { verify: false });
    // Nowhere near the 15s cap — the queue is already resolved.
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
