import { beforeEach, describe, expect, it, vi } from "vitest";

const restoreFocusContext = vi.fn((..._args: unknown[]) =>
  Promise.resolve(undefined),
);
const resolveTypingFocusTarget = vi.fn((..._args: unknown[]) => ({
  processName: "notepad",
}));
const isWhatsAppTabActive = vi.fn((..._args: unknown[]) => false);
const isGmailComposeFocused = vi.fn((..._args: unknown[]) => false);
const isInstagramTabActive = vi.fn((..._args: unknown[]) => false);
const runInsertWithFallback = vi.fn((..._args: unknown[]) =>
  Promise.resolve({ strategy: "native_text" }),
);
const hasPendingSelection = vi.fn((..._args: unknown[]) => false);

vi.mock("../../../focus/focusContext.js", () => ({
  restoreFocusContext: (...args: unknown[]) => restoreFocusContext(...args),
  resolveTypingFocusTarget: (...args: unknown[]) =>
    resolveTypingFocusTarget(...args),
  isWhatsAppTabActive: (...args: unknown[]) => isWhatsAppTabActive(...args),
  isGmailComposeFocused: (...args: unknown[]) => isGmailComposeFocused(...args),
  isInstagramTabActive: (...args: unknown[]) => isInstagramTabActive(...args),
}));

vi.mock("../../../automation/input/inputStrategy.js", () => ({
  runInsertWithFallback: (...args: unknown[]) =>
    runInsertWithFallback(...args),
}));

vi.mock("../../../automation/keyboard.js", () => ({
  sendKeyChord: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
}));

vi.mock("../../transform/transformSession.js", () => ({
  hasPendingSelection: (...args: unknown[]) => hasPendingSelection(...args),
}));

import {
  applyStreamingPartial,
  beginStreamingInsert,
  clearStreamingInsert,
  computeProvisionalEdit,
  getStreamingProvisional,
  shouldApplyPartialLive,
  takeStreamingProvisional,
} from "../streamingInsert.js";

describe("Phase 7.8 — streaming provisional edits", () => {
  it("appends when hypothesis grows with same prefix", () => {
    expect(computeProvisionalEdit("Hello", "Hello world")).toEqual({
      backspace: 0,
      type: " world",
    });
  });

  it("backspaces when hypothesis shrinks", () => {
    expect(computeProvisionalEdit("Hello world", "Hello")).toEqual({
      backspace: 6,
      type: "",
    });
  });

  it("rewrites from divergence point", () => {
    // "Hey Tatheer" → "Hey Tathir": shared prefix "Hey Tath", then eer→ir
    expect(computeProvisionalEdit("Hey Tatheer", "Hey Tathir")).toEqual({
      backspace: 3,
      type: "ir",
    });
  });

  it("no-ops when equal", () => {
    expect(computeProvisionalEdit("same", "same")).toEqual({
      backspace: 0,
      type: "",
    });
  });

  it("shouldApplyPartialLive only allows growth / first partial", () => {
    expect(shouldApplyPartialLive("", "Hello")).toBe(true);
    expect(shouldApplyPartialLive("Hello", "Hello world")).toBe(true);
    expect(shouldApplyPartialLive("Hello world", "Hello")).toBe(false);
    expect(shouldApplyPartialLive("Hello world", "Hey there")).toBe(false);
  });
});

describe("Phase 7.8 finalization — shouldSkipOsProgressive covers Gmail/Instagram", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWhatsAppTabActive.mockReturnValue(false);
    isGmailComposeFocused.mockReturnValue(false);
    isInstagramTabActive.mockReturnValue(false);
    hasPendingSelection.mockReturnValue(false);
    runInsertWithFallback.mockResolvedValue({ strategy: "native_text" });
    clearStreamingInsert();
  });

  it("types progressively on a plain OS field (baseline: not skipped)", async () => {
    beginStreamingInsert({ streamId: "s1" });
    await applyStreamingPartial({ streamId: "s1", text: "Hello" });
    expect(runInsertWithFallback).toHaveBeenCalledTimes(1);
    expect(getStreamingProvisional()).toBe("Hello");
  });

  it("skips progressive insert when Gmail compose is focused", async () => {
    isGmailComposeFocused.mockReturnValue(true);
    beginStreamingInsert({ streamId: "s2" });
    await applyStreamingPartial({ streamId: "s2", text: "Hello" });
    expect(runInsertWithFallback).not.toHaveBeenCalled();
    const snap = takeStreamingProvisional();
    expect(snap?.surface).toBe("skip");
  });

  it("skips progressive insert when Instagram DM tab is active", async () => {
    isInstagramTabActive.mockReturnValue(true);
    beginStreamingInsert({ streamId: "s3" });
    await applyStreamingPartial({ streamId: "s3", text: "Hello" });
    expect(runInsertWithFallback).not.toHaveBeenCalled();
    const snap = takeStreamingProvisional();
    expect(snap?.surface).toBe("skip");
  });

  it("still skips WhatsApp (pre-existing behavior unchanged)", async () => {
    isWhatsAppTabActive.mockReturnValue(true);
    beginStreamingInsert({ streamId: "s4" });
    await applyStreamingPartial({ streamId: "s4", text: "Hello" });
    expect(runInsertWithFallback).not.toHaveBeenCalled();
    const snap = takeStreamingProvisional();
    expect(snap?.surface).toBe("skip");
  });
});
