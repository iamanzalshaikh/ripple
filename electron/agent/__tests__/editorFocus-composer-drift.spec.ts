import { beforeEach, describe, expect, it, vi } from "vitest";

const getForegroundWindow = vi.fn();
const getFocusedA11yElement = vi.fn();
const clickBrowserComposerNative = vi.fn();
const restoreFocusContext = vi.fn();
const resolveTypingFocusTarget = vi.fn();

vi.mock("../../focus/focusContext.js", () => ({
  isDesktopShellForeground: (ctx: { processName?: string; windowTitle?: string }) => {
    const proc = (ctx.processName ?? "").toLowerCase();
    if (proc !== "explorer") return false;
    const title = (ctx.windowTitle ?? "").trim().toLowerCase();
    return !title || title === "program manager";
  },
  isWeakFocusContext: () => false,
  restoreFocusContext: (...args: unknown[]) => restoreFocusContext(...args),
  resolveTypingFocusTarget: (...args: unknown[]) => resolveTypingFocusTarget(...args),
}));

vi.mock("../../focus/saveDialogMode.js", () => ({
  isSaveDialogModalLocked: () => false,
  matchesMainDocumentA11y: () => true,
}));

vi.mock("../../native/win32Bridge.js", () => ({
  getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
  getFocusedA11yElement: (...args: unknown[]) => getFocusedA11yElement(...args),
  clickBrowserComposerNative: (...args: unknown[]) =>
    clickBrowserComposerNative(...args),
  focusWindowByHwnd: vi.fn(),
  getCursorPositionNative: vi.fn(),
  getWindowUnderCursorNative: vi.fn(),
  mouseClickNative: vi.fn(),
}));

describe("ensureBrowserComposerFocus focus-drift", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resolveTypingFocusTarget.mockReturnValue({
      hwnd: 42,
      processName: "chrome",
      windowTitle: "WhatsApp",
      isBrowser: true,
    });
    getFocusedA11yElement.mockResolvedValue({
      controlType: "ControlType.Group",
      name: "",
    });
    getForegroundWindow.mockResolvedValue({
      hwnd: 42,
      processName: "chrome",
      windowTitle: "WhatsApp",
    });
  });

  it("logs and fails when click is refused as point_outside_hwnd", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    clickBrowserComposerNative.mockResolvedValue({
      ok: false,
      reason: "point_outside_hwnd",
      method: "refused_click",
      x: -768,
      y: 1238,
      underProc: "explorer",
      underTitle: "Program Manager",
      insideWin: false,
      pointOnTarget: false,
    });

    const { ensureBrowserComposerFocus } = await import("../editorFocus.js");
    const ok = await ensureBrowserComposerFocus();
    expect(ok).toBe(false);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("[ripple-focus-drift] composer_click_refused_or_shell"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("restores focus when composer path leaves Program Manager in foreground", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    clickBrowserComposerNative.mockResolvedValue({
      ok: true,
      method: "click",
      x: -768,
      y: 1238,
      name: "Type a message",
    });
    getForegroundWindow.mockResolvedValue({
      hwnd: 1,
      processName: "explorer",
      windowTitle: "Program Manager",
    });

    const { ensureBrowserComposerFocus } = await import("../editorFocus.js");
    const ok = await ensureBrowserComposerFocus();
    expect(ok).toBe(false);
    expect(restoreFocusContext).toHaveBeenCalled();
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes("composer_left_shell_after_focus"),
      ),
    ).toBe(true);
    warn.mockRestore();
  });
});
