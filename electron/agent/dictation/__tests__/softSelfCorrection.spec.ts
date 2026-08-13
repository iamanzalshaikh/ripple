import { describe, expect, it, vi, beforeEach } from "vitest";
import { detectSoftSelfCorrection } from "../softSelfCorrection.js";
import {
  cleanupWithinBounds,
  rewriteDictationBuffer,
} from "../dictationRewrite.js";

const { aiRewriteDictation, analyzeDictationCorrection } = vi.hoisted(() => ({
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection: vi.fn(async () => null),
  generateDictationCorrection: vi.fn(async () => null),
}));

vi.mock("../aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => true,
  analyzeDictationCorrection,
  generateDictationCorrection: vi.fn(async () => null),
  aiRewriteDictation,
}));

vi.mock("../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) => text,
}));

vi.mock("../../storage/snippets.js", () => ({
  resolveSnippetTrigger: () => null,
}));

vi.mock("../../storage/styleProfiles.js", () => ({
  getStyleProfileForProcess: () => null,
}));

describe("soft self-correction class (production)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiRewriteDictation.mockResolvedValue(null);
    analyzeDictationCorrection.mockResolvedValue(null);
  });

  it("detects mid-utterance notes→wallet via sorry (class cue, not Layer-1)", () => {
    const hit = detectSoftSelfCorrection(
      "note down all the changes of the notes Sorry, all of the changes of the wallet",
    );
    expect(hit.detected).toBe(true);
    expect(hit.cue?.toLowerCase()).toContain("sorry");
  });

  it("does not unlock standalone apologies", () => {
    expect(detectSoftSelfCorrection("Sorry I'm late today").detected).toBe(
      false,
    );
    expect(
      detectSoftSelfCorrection("Sorry about that").detected,
    ).toBe(false);
  });

  it("allowSoftRevision accepts AI drop of superseded notes clause", () => {
    const src =
      "Can you please note down all those changes of the notes Sorry, all of the changes of the wallet";
    const cleaned =
      "Can you please note down all of the changes of the wallet.";
    expect(cleanupWithinBounds(src, cleaned)).toBe(false);
    expect(
      cleanupWithinBounds(src, cleaned, { allowSoftRevision: true }),
    ).toBe(true);
  });

  it("orchestrator accepts AI soft-revision cleanup for notes/sorry/wallet", async () => {
    const input =
      "Can you please note down all those changes of the notes Sorry, all of the changes of the wallet";
    aiRewriteDictation.mockResolvedValueOnce(
      "Can you please note down all of the changes of the wallet.",
    );
    const result = await rewriteDictationBuffer({ bufferText: input });
    expect(result.finalText.toLowerCase()).toContain("wallet");
    expect(result.finalText.toLowerCase()).not.toContain("notes");
    expect(result.decisionLog.reason).toBe("ai_cleanup+soft_revision");
  });
});
