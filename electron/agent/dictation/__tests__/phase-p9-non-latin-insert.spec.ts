import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDictationSessionForTests } from "../dictationSession.js";
import { resetSessionWindowForTests } from "../dictationSessionWindow.js";

/**
 * P9.5 review gap #2/#3 — the insert step had zero non-Latin/RTL test
 * coverage; every prior test that exercises the real insert call used
 * Latin-only strings. The native Rust layer already uses SendInput with
 * KEYEVENTF_UNICODE (verified by reading ripple-native/src/send_input.rs —
 * not retestable from here), so what these tests actually cover is the
 * JS-side pipeline between "Whisper transcript" and "text handed to the
 * insert ladder": does cleanup/correction/capitalization mangle Devanagari
 * or Arabic script on the way through.
 */

vi.mock("../../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) => text,
}));

vi.mock("../aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => false,
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection: vi.fn(async () => null),
  generateDictationCorrection: vi.fn(async () => null),
}));

const runInsertText = vi.fn(async (..._args: unknown[]) => "typed");
vi.mock("../../../automation/actions/insertText.js", () => ({
  runInsertText: (...args: unknown[]) => runInsertText(...args),
}));

vi.mock("../../../windows/overlay.js", () => ({
  hideOverlay: vi.fn(),
  hideOverlayToPinnedTarget: vi.fn(async () => true),
}));

vi.mock("../../../focus/focusContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../focus/focusContext.js")>();
  return {
    ...actual,
    restoreFocusContext: vi.fn(async () => true),
    prepareDictationInsertFocus: vi.fn(async () => true),
    hasDictationInsertTarget: vi.fn(() => true),
  };
});

describe("P9.5 non-Latin / RTL script survives the dictation pipeline to insert", () => {
  beforeEach(() => {
    resetDictationSessionForTests();
    resetSessionWindowForTests();
    runInsertText.mockClear();
  });
  afterEach(() => {
    resetDictationSessionForTests();
    resetSessionWindowForTests();
  });

  it("Hindi (Devanagari) reaches the insert ladder without corruption", async () => {
    const { executeDictationUtterance } = await import("../executeDictation.js");
    const hindi = "नमस्ते आप कैसे हैं";

    const res = await executeDictationUtterance(hindi, { insert: true });

    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(true);
    expect(runInsertText).toHaveBeenCalledTimes(1);
    const typed = (runInsertText.mock.calls[0]?.[0] as { text?: string })?.text ?? "";
    // Every Devanagari codepoint from the source utterance must still be
    // present — cleanup/capitalization must not drop or replace them.
    for (const ch of hindi) {
      if (ch === " ") continue;
      expect(typed).toContain(ch);
    }
  });

  it("Urdu (Arabic script, RTL) reaches the insert ladder without corruption", async () => {
    const { executeDictationUtterance } = await import("../executeDictation.js");
    const urdu = "آپ کیسے ہیں";

    const res = await executeDictationUtterance(urdu, { insert: true });

    expect(res.ok).toBe(true);
    expect(res.inserted).toBe(true);
    const typed = (runInsertText.mock.calls[0]?.[0] as { text?: string })?.text ?? "";
    for (const ch of urdu) {
      if (ch === " ") continue;
      expect(typed).toContain(ch);
    }
  });

  it("a comma-separated stutter in Hindi does not get corrupted (even if not collapsed)", async () => {
    // Documents a real, separate limitation found while writing this
    // coverage: collapseStutters()'s /\w+/ character class is ASCII-only in
    // JS regex, so it silently does not collapse non-Latin stutters — this
    // is a no-op, not corruption. Asserting non-corruption here; the
    // stutter-collapse gap itself is a follow-up, not part of this fix.
    const { executeDictationUtterance } = await import("../executeDictation.js");
    const stutter = "क्या, क्या, क्या हुआ";

    const res = await executeDictationUtterance(stutter, { insert: true });

    expect(res.ok).toBe(true);
    const typed = (runInsertText.mock.calls[0]?.[0] as { text?: string })?.text ?? "";
    expect(typed).toContain("क्या");
    expect(typed).toContain("हुआ");
  });
});
