import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertWhatsAppComposeText } from "../../automation/adapters/whatsapp/whatsappComposeInsert.js";

const runInsertWithFallback = vi.fn();
const replaceWhatsAppComposerViaExtension = vi.fn();
const restoreFocusContext = vi.fn();
const getInsertTextA11yDiagnostics = vi.fn();
const selectAll = vi.fn();
const sendKeyChord = vi.fn();

vi.mock("../../automation/input/inputStrategy.js", () => ({
  runInsertWithFallback: (...args: unknown[]) => runInsertWithFallback(...args),
}));

vi.mock("../../bridge/nativeMessagingBridge.js", () => ({
  replaceWhatsAppComposerViaExtension: (...args: unknown[]) =>
    replaceWhatsAppComposerViaExtension(...args),
}));

vi.mock("../../focus/focusContext.js", () => ({
  restoreFocusContext: (...args: unknown[]) => restoreFocusContext(...args),
}));

vi.mock("../../native/win32Bridge.js", () => ({
  getInsertTextA11yDiagnostics: (...args: unknown[]) =>
    getInsertTextA11yDiagnostics(...args),
}));

vi.mock("../../automation/keyboard.js", () => ({
  selectAll: (...args: unknown[]) => selectAll(...args),
  sendKeyChord: (...args: unknown[]) => sendKeyChord(...args),
}));

vi.mock("../../agent/observe.js", () => ({
  captureObservation: vi.fn(async () => ({
    foreground: { hwnd: 1, processName: "chrome", windowTitle: "WhatsApp" },
    focusedA11y: {
      controlType: "ControlType.Edit",
      name: "Type a message",
      value: "",
    },
    timestamp: Date.now(),
  })),
}));

describe("P7.3 WhatsApp OS-first compose insertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreFocusContext.mockResolvedValue(undefined);
    selectAll.mockResolvedValue(undefined);
    sendKeyChord.mockResolvedValue(undefined);
    getInsertTextA11yDiagnostics.mockResolvedValue({
      focused: { value: "" },
    });
    runInsertWithFallback.mockResolvedValue({
      detail: "Typed 5 characters (native_text)",
      strategy: "native_text",
    });
    replaceWhatsAppComposerViaExtension.mockResolvedValue(
      "Updated WhatsApp message",
    );
  });

  it("uses the OS insert ladder before the extension", async () => {
    const result = await insertWhatsAppComposeText("hello");

    expect(result).toContain("native_text");
    expect(runInsertWithFallback).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        verify: true,
        includeVision: false,
        acceptUnverifiableEdit: true,
      }),
    );
    expect(replaceWhatsAppComposerViaExtension).not.toHaveBeenCalled();
    expect(selectAll).not.toHaveBeenCalled();
  });

  it("clears the composer before OS insert when replaceAll is set", async () => {
    await insertWhatsAppComposeText("more confident version", {
      replaceAll: true,
    });

    expect(selectAll).toHaveBeenCalled();
    expect(sendKeyChord).toHaveBeenCalledWith("{BACKSPACE}");
    expect(runInsertWithFallback).toHaveBeenCalledWith(
      "more confident version",
      expect.objectContaining({ replaceAll: true }),
    );
    expect(replaceWhatsAppComposerViaExtension).not.toHaveBeenCalled();
  });

  it("retries the clear when the composer still has leftover text, then types anyway if it never clears", async () => {
    getInsertTextA11yDiagnostics.mockResolvedValue({
      focused: { value: "leftover text" },
    });

    await insertWhatsAppComposeText("more confident version", {
      replaceAll: true,
    });

    expect(selectAll).toHaveBeenCalledTimes(3);
    expect(runInsertWithFallback).toHaveBeenCalledWith(
      "more confident version",
      expect.objectContaining({ replaceAll: true }),
    );
  });

  it("uses extension replacement only after the OS ladder fails", async () => {
    runInsertWithFallback.mockRejectedValueOnce(
      new Error("All OS insert strategies failed"),
    );

    const result = await insertWhatsAppComposeText("fallback text");

    expect(result).toBe("Updated WhatsApp message");
    expect(runInsertWithFallback).toHaveBeenCalledTimes(1);
    expect(replaceWhatsAppComposerViaExtension).toHaveBeenCalledWith(
      "fallback text",
    );
  });

  it("reports a combined composer failure when both paths fail", async () => {
    runInsertWithFallback.mockRejectedValueOnce(new Error("OS failed"));
    replaceWhatsAppComposerViaExtension.mockRejectedValueOnce(
      new Error("extension failed"),
    );

    await expect(insertWhatsAppComposeText("hello")).rejects.toThrow(
      "Could not type into WhatsApp composer: extension failed",
    );
  });
});
