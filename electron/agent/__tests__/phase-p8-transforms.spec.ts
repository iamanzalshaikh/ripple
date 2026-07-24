import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasPendingSelection,
  resetTransformSessionForTests,
  setPendingSelection,
  takePendingSelection,
} from "../transform/transformSession.js";

const selectAll = vi.fn(async (..._args: unknown[]) => undefined);
const pasteFromClipboard = vi.fn(async (..._args: unknown[]) => undefined);
const writeText = vi.fn();

vi.mock("../dictation/aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => false,
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection: vi.fn(async () => null),
  generateDictationCorrection: vi.fn(),
}));

vi.mock("../../windows/overlay.js", () => ({
  hideOverlay: vi.fn(),
}));

vi.mock("../../focus/focusContext.js", () => ({
  restoreFocusContext: vi.fn(async () => undefined),
  resolveTypingFocusTarget: vi.fn(() => ({
    processName: "Notepad",
    windowTitle: "Untitled - Notepad",
    hwnd: 1,
  })),
}));

vi.mock("../../native/win32Bridge.js", () => ({
  getFocusedA11yElement: vi.fn(async () => ({
    name: "Text editor",
    controlType: "ControlType.Document",
    automationId: "",
    className: "RichEditD2DPT",
    value: "check this pls",
  })),
}));

vi.mock("../../automation/keyboard.js", () => ({
  selectAll: (...args: unknown[]) => selectAll(...args),
  pasteFromClipboard: (...args: unknown[]) => pasteFromClipboard(...args),
  sendKeyChord: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  clipboard: {
    writeText: (...args: unknown[]) => writeText(...args),
    readText: vi.fn(() => ""),
  },
}));

describe("P8 transformSession", () => {
  beforeEach(() => {
    resetTransformSessionForTests();
  });
  afterEach(() => {
    resetTransformSessionForTests();
    vi.useRealTimers();
  });

  it("has no pending selection by default", () => {
    expect(hasPendingSelection()).toBe(false);
    expect(takePendingSelection()).toBeNull();
  });

  it("stores and consumes a selection exactly once", () => {
    setPendingSelection("hello world");
    expect(hasPendingSelection()).toBe(true);
    expect(takePendingSelection()).toBe("hello world");
    expect(hasPendingSelection()).toBe(false);
    expect(takePendingSelection()).toBeNull();
  });

  it("ignores empty/whitespace-only selections", () => {
    setPendingSelection("   ");
    expect(hasPendingSelection()).toBe(false);
  });

  it("expires a stale selection after the TTL (leak backstop)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    setPendingSelection("stale text");
    expect(hasPendingSelection()).toBe(true);

    vi.setSystemTime(91_000);
    expect(hasPendingSelection()).toBe(false);
    expect(takePendingSelection()).toBeNull();
  });
});

describe("P8 executeTransform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectAll.mockResolvedValue(undefined);
    pasteFromClipboard.mockResolvedValue(undefined);
  });

  it("rewrites the selection and inserts via clipboard replace", async () => {
    const { generateDictationCorrection } = await import(
      "../dictation/aiRewriteDictation.js"
    );
    vi.mocked(generateDictationCorrection).mockResolvedValue({
      generation: {
        generatedText: "Please review this at your convenience.",
        droppedContent: [],
      },
    } as never);

    const { executeTransform } = await import("../transform/executeTransform.js");
    const result = await executeTransform("check this pls", "make this more formal");

    expect(result.ok).toBe(true);
    expect(result.finalText).toBe("Please review this at your convenience.");
    expect(writeText).toHaveBeenCalledWith("Please review this at your convenience.");
    expect(selectAll).toHaveBeenCalled();
    expect(pasteFromClipboard).toHaveBeenCalled();
  });

  it("replaces only the selected fragment inside a longer field", async () => {
    const { getFocusedA11yElement } = await import("../../native/win32Bridge.js");
    vi.mocked(getFocusedA11yElement).mockResolvedValueOnce({
      name: "Text editor",
      controlType: "ControlType.Document",
      automationId: "",
      className: "RichEditD2DPT",
      value:
        "Hey, how are you? I want to meet you yesterday for the coffee meeting. Are you free for that day",
    });
    const { generateDictationCorrection } = await import(
      "../dictation/aiRewriteDictation.js"
    );
    vi.mocked(generateDictationCorrection).mockResolvedValue({
      generation: {
        generatedText: "Are you free then, my friend?",
        droppedContent: [],
      },
    } as never);

    const { executeTransform } = await import("../transform/executeTransform.js");
    const result = await executeTransform(
      "Are you free for that day",
      "make this text more emotional",
    );

    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith(
      "Hey, how are you? I want to meet you yesterday for the coffee meeting. Are you free then, my friend?",
    );
  });

  it("fails without throwing when there is nothing selected", async () => {
    const { executeTransform } = await import("../transform/executeTransform.js");
    const result = await executeTransform("", "make this more formal");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_selection");
  });

  it("fails when no instruction was spoken", async () => {
    const { executeTransform } = await import("../transform/executeTransform.js");
    const result = await executeTransform("some text", "");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("no_instruction");
  });

  it("reports rewrite_failed when the backend returns nothing", async () => {
    const { generateDictationCorrection } = await import(
      "../dictation/aiRewriteDictation.js"
    );
    vi.mocked(generateDictationCorrection).mockResolvedValue(null as never);

    const { executeTransform } = await import("../transform/executeTransform.js");
    const result = await executeTransform("check this pls", "make this more formal");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("rewrite_failed");
  });

  it("reports insert failure separately from rewrite failure", async () => {
    const { generateDictationCorrection } = await import(
      "../dictation/aiRewriteDictation.js"
    );
    vi.mocked(generateDictationCorrection).mockResolvedValue({
      generation: { generatedText: "Rewritten.", droppedContent: [] },
    } as never);
    pasteFromClipboard.mockRejectedValueOnce(new Error("insert ladder exhausted"));

    const { executeTransform } = await import("../transform/executeTransform.js");
    const result = await executeTransform("check this pls", "make this more formal");
    expect(result.ok).toBe(false);
    expect(result.inserted).toBe(false);
    expect(result.error).toBe("insert ladder exhausted");
  });
});

describe("P8 buildTransformFieldText", () => {
  it("swaps a partial selection inside the field", async () => {
    const { buildTransformFieldText } = await import("../transform/executeTransform.js");
    const out = buildTransformFieldText(
      "Hello world. Thanks.",
      "Hello world.",
      "Greetings.",
    );
    expect(out?.mode).toBe("partial");
    expect(out?.text).toBe("Greetings. Thanks.");
  });

  it("refuses to wipe the field when the fragment is missing", async () => {
    const { buildTransformFieldText } = await import("../transform/executeTransform.js");
    const out = buildTransformFieldText(
      "Hello world. Thanks.",
      "not in the field at all",
      "Greetings.",
    );
    expect(out).toBeNull();
  });
});

describe("P8 executeDictationUtterance routes to Transforms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectAll.mockResolvedValue(undefined);
    pasteFromClipboard.mockResolvedValue(undefined);
    resetTransformSessionForTests();
  });
  afterEach(() => {
    resetTransformSessionForTests();
  });

  it("runs the transform path and skips the dictation buffer when a selection is pending", async () => {
    const { getFocusedA11yElement } = await import("../../native/win32Bridge.js");
    vi.mocked(getFocusedA11yElement).mockResolvedValue({
      name: "Text editor",
      controlType: "ControlType.Document",
      automationId: "",
      className: "RichEditD2DPT",
      value: "original selected text",
    });
    const { generateDictationCorrection } = await import(
      "../dictation/aiRewriteDictation.js"
    );
    vi.mocked(generateDictationCorrection).mockResolvedValue({
      generation: { generatedText: "Rewritten output.", droppedContent: [] },
    } as never);

    const { resetDictationSessionForTests, getRevisionBuffer } = await import(
      "../dictation/dictationSession.js"
    );
    resetDictationSessionForTests();
    setPendingSelection("original selected text");

    const { executeDictationUtterance } = await import("../dictation/executeDictation.js");
    const res = await executeDictationUtterance("make this more formal", { insert: true });

    expect(res.transform).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.finalText).toBe("Rewritten output.");
    expect(getRevisionBuffer().text).toBe("");
    expect(hasPendingSelection()).toBe(false);
  });

  it("falls through to normal dictation when nothing is pending", async () => {
    const { resetDictationSessionForTests } = await import("../dictation/dictationSession.js");
    resetDictationSessionForTests();
    expect(hasPendingSelection()).toBe(false);

    const { executeDictationUtterance } = await import("../dictation/executeDictation.js");
    const res = await executeDictationUtterance("hello world", { insert: true });

    expect(res.transform).toBeUndefined();
    expect(res.finalText?.toLowerCase()).toContain("hello world");
  });
});
