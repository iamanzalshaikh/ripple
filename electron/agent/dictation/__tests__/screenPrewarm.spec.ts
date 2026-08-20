import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Latency Phase 4 — the screen gather (UIA + OCR) must not sit on the critical
 * path between STT finishing and the paste landing.
 *
 * Live evidence before this change: `ocr_ms` 180–480 ms (budget allows 2500 ms)
 * added directly to stop→paste, because the gather only started once the
 * transcript existed — even though it depends on the screen, not the words.
 */

const captureScreenOcr = vi.fn();
const resolveTypingFocusTarget = vi.fn(() => ({
  hwnd: 111,
  processName: "chrome",
  windowTitle: "Umar Khan - WhatsApp",
}));

vi.mock("../../../automation/ai/aiHelpers.js", () => ({
  captureScreenOcr: (hwnd?: number) => captureScreenOcr(hwnd),
}));

vi.mock("../../../focus/focusContext.js", () => ({
  resolveTypingFocusTarget: () => resolveTypingFocusTarget(),
  maintainPinnedTargetDuringRewrite: vi.fn(async () => undefined),
}));

vi.mock("../../../native/win32Bridge.js", () => ({
  getForegroundWindow: vi.fn(async () => ({
    hwnd: 111,
    processName: "chrome",
    windowTitle: "Umar Khan - WhatsApp",
  })),
  getUiaScreenTextNative: vi.fn(async () => ""),
}));

const SCREEN = "Umar Khan\nonline\nUmar Khan\nType a message";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Latency Phase 4 — screen gather prewarm", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    captureScreenOcr.mockImplementation(async () => {
      await sleep(150); // stand-in for real OCR wall time
      return { ocr: { text: SCREEN } };
    });
  });

  it("a prewarmed gather is consumed, not re-run", async () => {
    const mod = await import("../screenNameBias.js");
    mod.resetScreenPrewarmForTests();

    mod.prewarmScreenContext();
    await sleep(250); // OCR completes while STT would still be running

    const callsAfterPrewarm = captureScreenOcr.mock.calls.length;
    expect(callsAfterPrewarm).toBe(1);

    const started = Date.now();
    await mod.biasUtteranceFromScreen("tell umar i am coming");
    const elapsed = Date.now() - started;

    // The gather was NOT repeated...
    expect(captureScreenOcr.mock.calls.length).toBe(callsAfterPrewarm);
    // ...and compose did not pay the OCR wall time again.
    expect(elapsed).toBeLessThan(100);
  });

  it("without a prewarm it still gathers inline (unchanged behaviour)", async () => {
    const mod = await import("../screenNameBias.js");
    mod.resetScreenPrewarmForTests();

    await mod.biasUtteranceFromScreen("tell umar i am coming");
    expect(captureScreenOcr.mock.calls.length).toBe(1);
  });

  it("produces the SAME bias result prewarmed or not", async () => {
    const mod = await import("../screenNameBias.js");

    mod.resetScreenPrewarmForTests();
    const inline = await mod.biasUtteranceFromScreen("tell ummer i am coming");

    mod.resetScreenPrewarmForTests();
    mod.prewarmScreenContext();
    await sleep(250);
    const warmed = await mod.biasUtteranceFromScreen("tell ummer i am coming");

    expect(warmed.text).toBe(inline.text);
    expect(warmed.replacements.map((r) => `${r.from}->${r.to}`)).toEqual(
      inline.replacements.map((r) => `${r.from}->${r.to}`),
    );
  });

  it("an EMPTY prewarm regathers inline so name quality never degrades", async () => {
    const mod = await import("../screenNameBias.js");
    mod.resetScreenPrewarmForTests();

    // First gather (the prewarm) yields nothing — OCR timeout / self-capture.
    captureScreenOcr.mockImplementationOnce(async () => ({ ocr: { text: "" } }));
    mod.prewarmScreenContext();
    await sleep(120);

    const res = await mod.biasUtteranceFromScreen("tell ummer i am coming");

    // It retried rather than accepting the empty result...
    expect(captureScreenOcr.mock.calls.length).toBe(2);
    // ...and still found the name.
    expect(res.text.toLowerCase()).toContain("umar");
  });

  it("a failed prewarm never rejects and never breaks dictation", async () => {
    const mod = await import("../screenNameBias.js");
    mod.resetScreenPrewarmForTests();

    captureScreenOcr.mockImplementationOnce(async () => {
      throw new Error("ocr_exploded");
    });
    mod.prewarmScreenContext();
    await sleep(120);

    // Fails open to the original utterance, no throw.
    const res = await mod.biasUtteranceFromScreen("tell someone hello");
    expect(res.text).toBeTruthy();
  });

  it("repeated prewarms do not stack duplicate OCR work", async () => {
    const mod = await import("../screenNameBias.js");
    mod.resetScreenPrewarmForTests();

    mod.prewarmScreenContext();
    mod.prewarmScreenContext();
    mod.prewarmScreenContext();
    await sleep(250);

    expect(captureScreenOcr.mock.calls.length).toBe(1);
  });
});
