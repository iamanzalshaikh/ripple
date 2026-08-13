import { beforeEach, describe, expect, it, vi } from "vitest";

const getForegroundWindow = vi.fn();
const getFocusedA11yElement = vi.fn();

vi.mock("../../native/win32Bridge.js", () => ({
  getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
  getFocusedA11yElement: (...args: unknown[]) => getFocusedA11yElement(...args),
}));

const resolveTypingFocusTarget = vi.fn();

vi.mock("../../focus/focusContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../focus/focusContext.js")>();
  return {
    ...actual,
    resolveTypingFocusTarget: (...args: unknown[]) =>
      resolveTypingFocusTarget(...args),
  };
});

describe("verifyTypingObservation pinned target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTypingFocusTarget.mockReturnValue({
      hwnd: 500,
      processName: "chrome",
      windowTitle: "Google Chat",
      isBrowser: true,
      capturedAt: 0,
      isGmail: false,
      isWhatsApp: false,
      isSlack: false,
      isNotion: false,
      isYouTube: false,
      isLinkedIn: false,
      isInstagram: false,
    });
  });

  it("accepts explorer→chrome restore when text is in composer", async () => {
    getForegroundWindow.mockResolvedValue({
      hwnd: 500,
      processName: "chrome",
      windowTitle: "Google Chat",
    });
    getFocusedA11yElement.mockResolvedValue({
      controlType: "ControlType.Edit",
      name: "History is on",
      value: "Hello, how are you?",
      automationId: "hj99tb0",
      className: "editable",
    });

    const { verifyTypingObservation } = await import("../observe.js");
    const result = await verifyTypingObservation({
      before: {
        foreground: {
          hwnd: 65880,
          processName: "explorer",
          windowTitle: "",
        },
        focusedA11y: null,
        timestamp: Date.now(),
      },
      expectedText: "Hello, how are you?",
      settleMs: 0,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects cursor insert when pinned target is chrome", async () => {
    getForegroundWindow.mockResolvedValue({
      hwnd: 999,
      processName: "Cursor",
      windowTitle: "focusContext.ts",
    });
    getFocusedA11yElement.mockResolvedValue({
      controlType: "ControlType.Edit",
      name: "",
      value: "Hello, how are you?",
      automationId: "",
      className: "aislash-editor-input",
    });

    const { verifyTypingObservation } = await import("../observe.js");
    const result = await verifyTypingObservation({
      before: {
        foreground: {
          hwnd: 888,
          processName: "Cursor",
          windowTitle: "Terminal",
        },
        focusedA11y: {
          controlType: "ControlType.Edit",
          name: "Terminal",
          value: "",
          automationId: "",
          className: "xterm",
        },
        timestamp: Date.now(),
      },
      expectedText: "Hello, how are you?",
      settleMs: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_insert_target");
  });
});
