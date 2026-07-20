import { beforeEach, describe, expect, it, vi } from "vitest";

const getForegroundWindow = vi.fn();
const getFocusedA11yElement = vi.fn();

vi.mock("../../native/win32Bridge.js", () => ({
  getForegroundWindow: (...args: unknown[]) => getForegroundWindow(...args),
  getFocusedA11yElement: (...args: unknown[]) => getFocusedA11yElement(...args),
}));

vi.mock("../../focus/focusContext.js", () => ({
  isRippleApplicationWindow: () => false,
}));

describe("verifyTypingObservation value preference (P7.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getForegroundWindow.mockResolvedValue({
      hwnd: 1,
      processName: "chrome",
      windowTitle: "WhatsApp",
    });
  });

  it("accepts when value has typed text even if name is still the placeholder", async () => {
    getFocusedA11yElement
      .mockResolvedValueOnce({
        name: "Type a message to Aftab",
        value: "",
        controlType: "ControlType.Edit",
      })
      .mockResolvedValueOnce({
        name: "Type a message to Aftab",
        value: "hello bro how are you",
        controlType: "ControlType.Edit",
      });

    const { captureObservation, verifyTypingObservation } = await import(
      "../observe.js"
    );
    const before = await captureObservation();
    const result = await verifyTypingObservation({
      before,
      expectedText: "hello bro how are you",
      settleMs: 0,
    });
    expect(result.ok).toBe(true);
  });

  it("does not fail on placeholder name when value grew in an edit field", async () => {
    getFocusedA11yElement
      .mockResolvedValueOnce({
        name: "Type a message",
        value: "",
        controlType: "ControlType.Edit",
      })
      .mockResolvedValueOnce({
        name: "Type a message",
        value: "hi",
        controlType: "ControlType.Edit",
      });

    const { captureObservation, verifyTypingObservation } = await import(
      "../observe.js"
    );
    const before = await captureObservation();
    const result = await verifyTypingObservation({
      before,
      expectedText: "hello there friend",
      settleMs: 0,
    });
    expect(result.ok).toBe(true);
  });
});
