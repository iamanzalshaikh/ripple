import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Row 2.5 — the target window is CLOSED while the user is still dictating.
 *
 * The pinned hwnd is now destroyed: IsWindowVisible/IsIconic report false and
 * the foreground has moved to whatever surfaced behind it. The requirement is
 * not just "don't crash" — it is that the send is refused (so the text cannot
 * land in the unrelated window that took its place) AND the dictation is not
 * lost.
 */

const getPreSendStateNative = vi.fn();

vi.mock("../../../native/win32Bridge.js", () => ({
  getPreSendStateNative: (hwnd?: number) => getPreSendStateNative(hwnd),
}));

const PINNED = { hwnd: 4242, processName: "notepad", windowTitle: "Untitled" };

vi.mock("../../../focus/focusContext.js", () => ({
  resolveTypingFocusTarget: () => PINNED,
}));

vi.mock("../../delay.js", () => ({ delay: async () => undefined }));

/** What Win32 reports for an hwnd whose window has been destroyed. */
const DESTROYED_TARGET = {
  win: false,
  ctrl: false,
  shift: false,
  alt: false,
  visible: false,
  iconic: false,
  fgHwnd: 9001, // the window that surfaced behind it
  fgProc: "explorer",
};

describe("Row 2.5 — target window closed mid-dictation", () => {
  const realPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    Object.defineProperty(process, "platform", { value: "win32" });
  });

  afterAll(() => {
    Object.defineProperty(process, "platform", { value: realPlatform });
  });

  it("refuses to send into the window that took the closed one's place", async () => {
    getPreSendStateNative.mockResolvedValue(DESTROYED_TARGET);

    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("native_text")).rejects.toThrow(
      "insert_aborted:target_not_visible",
    );
  });

  it("aborts for every strategy, so no ladder rung sneaks the text through", async () => {
    getPreSendStateNative.mockResolvedValue(DESTROYED_TARGET);
    const { assertPreSendGates } = await import("../insertGates.js");

    for (const strategy of ["native_text", "sendkeys", "clipboard_paste"]) {
      await expect(assertPreSendGates(strategy)).rejects.toThrow(
        "insert_aborted:target_not_visible",
      );
    }
  });

  it("still sends if the window comes back before the deadline", async () => {
    // Closed-looking on the first probe, healthy on the next: must not abort
    // on a transient blip (e.g. the app repainting during a tab switch).
    getPreSendStateNative
      .mockResolvedValueOnce(DESTROYED_TARGET)
      .mockResolvedValue({
        ...DESTROYED_TARGET,
        visible: true,
        fgHwnd: PINNED.hwnd,
        fgProc: "notepad",
      });

    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("native_text")).resolves.toBeUndefined();
  });
});

describe("Row 2.5 — the dictation must survive the abort", () => {
  // A copied regex in a test drifts silently when the source changes, so read
  // the real classifier out of executeDictation.ts and exercise THAT.
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../agent/dictation/executeDictation.ts",
    ),
    "utf8",
  );

  it("the shipped classifier treats target_not_visible as recoverable", () => {
    const match = source.match(
      /!\/(no_focus_target\|[^/]+)\/i\.test\(\s*\n?\s*message,?\s*\n?\s*\)/,
    );
    expect(match, "recoverable-failure regex not found in source").toBeTruthy();

    const shipped = new RegExp(match![1], "i");
    expect(shipped.test("insert_aborted:target_not_visible")).toBe(true);
  });

  it("the abort still copies the dictation to the clipboard", () => {
    // If this ever disappears, a closed window silently eats the user's words.
    expect(source).toContain("clipboard.writeText(copy)");
    expect(source).toContain("text copied to clipboard");
  });

  it("a closed window gets its own hint, not the generic one", () => {
    expect(source).toMatch(/target_not_visible/);
    expect(source).toContain(
      "Couldn't insert — target window is minimized or hidden",
    );
  });

  it("all three dictation failure paths pass the text through for rescue", () => {
    const calls = source.match(/notifyDictationInsertFailure\(/g) ?? [];
    // 3 call sites + the declaration.
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // Every call site forwards confirmed.text as the rescue payload.
    const withText =
      source.match(/notifyDictationInsertFailure\([^)]*confirmed\.text/g) ?? [];
    expect(withText.length).toBe(3);
  });
});
