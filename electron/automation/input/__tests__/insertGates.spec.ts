import { beforeEach, describe, expect, it, vi } from "vitest";

const getPreSendStateNative = vi.fn();

vi.mock("../../../native/win32Bridge.js", () => ({
  getPreSendStateNative: (...args: unknown[]) => getPreSendStateNative(...args),
}));

vi.mock("../../../focus/focusContext.js", () => ({
  resolveTypingFocusTarget: () => ({
    hwnd: 777,
    processName: "chrome",
    windowTitle: "Claude - Google Chrome",
  }),
}));

function state(over: Partial<Record<string, unknown>> = {}) {
  return {
    win: false,
    ctrl: false,
    shift: false,
    alt: false,
    visible: true,
    iconic: false,
    fgHwnd: 777,
    fgProc: "chrome",
    ...over,
  };
}

describe("pre-send insert gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("passes with clean modifiers and a visible target", async () => {
    getPreSendStateNative.mockResolvedValue(state());
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("clipboard_paste")).resolves.toBeUndefined();
    expect(getPreSendStateNative).toHaveBeenCalledWith(777);
  });

  it("aborts insert_aborted:modifier_win_down when Win stays down past the wait", async () => {
    getPreSendStateNative.mockResolvedValue(state({ win: true }));
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("clipboard_paste")).rejects.toThrow(
      /insert_aborted:modifier_win_down/,
    );
  });

  it("proceeds when Win is released within the wait window", async () => {
    let calls = 0;
    getPreSendStateNative.mockImplementation(async () => {
      calls += 1;
      return state({ win: calls < 2 });
    });
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("sendkeys")).resolves.toBeUndefined();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("aborts insert_aborted:target_not_visible when target stays iconic", async () => {
    getPreSendStateNative.mockResolvedValue(state({ iconic: true }));
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("clipboard_paste")).rejects.toThrow(
      /insert_aborted:target_not_visible/,
    );
  });

  it("aborts insert_aborted:target_not_visible when target stays hidden AND is not foreground", async () => {
    getPreSendStateNative.mockResolvedValue(
      state({ visible: false, fgHwnd: 999 }),
    );
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("native_text")).rejects.toThrow(
      /insert_aborted:target_not_visible/,
    );
  });

  it("proceeds when visible=0 but the target IS the foreground (Windows 11 Notepad)", async () => {
    // Win11 Notepad's WinUI shell reports IsWindowVisible=0 for its own
    // foreground window (verified live). It is reachable by definition, so
    // the gate must not refuse — this previously blocked every Notepad insert.
    getPreSendStateNative.mockResolvedValue(
      state({ visible: false, iconic: false, fgHwnd: 777 }),
    );
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("native_text")).resolves.toBeUndefined();
  });

  it("still aborts when the target is minimized even if it reports foreground", async () => {
    getPreSendStateNative.mockResolvedValue(
      state({ visible: true, iconic: true, fgHwnd: 777 }),
    );
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("native_text")).rejects.toThrow(
      /insert_aborted:target_not_visible/,
    );
  });

  it("proceeds when the target is restored within the wait window", async () => {
    let calls = 0;
    getPreSendStateNative.mockImplementation(async () => {
      calls += 1;
      return state({ iconic: calls < 3 });
    });
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("clipboard_paste")).resolves.toBeUndefined();
  });

  it("skips (does not throw) when the native probe is unavailable", async () => {
    getPreSendStateNative.mockResolvedValue(null);
    const { assertPreSendGates } = await import("../insertGates.js");
    await expect(assertPreSendGates("clipboard_paste")).resolves.toBeUndefined();
  });
});
