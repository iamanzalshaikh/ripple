import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareComposeDictationText } from "../dictation/prepareComposeText.js";

const isGmailComposeFocused = vi.fn(() => false);

vi.mock("../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) =>
    text.replace(/\bnor\b/gi, "Noor"),
}));

vi.mock("../../focus/focusContext.js", () => ({
  isGmailComposeFocused: (...args: unknown[]) =>
    isGmailComposeFocused(...args),
  isWhatsAppTabActive: () => false,
}));

vi.mock("../dictation/aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => false,
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection: vi.fn(async (input: { currentUtterance: string }) => ({
    decision: {
      isCorrection: true,
      type: "replace",
      scope: "phrase",
      confidence: 0.96,
      original: "just text me at 9 o'clock",
      replacement: "just text me at 10",
      rewriteInstruction: null,
      correctionReason: "time_change",
      reason: `time revision in ${input.currentUtterance}`,
    },
    model: "test",
  })),
  generateDictationCorrection: vi.fn(async () => null),
}));

describe("prepareComposeDictationText (P7.2 + P7.4)", () => {
  it("applies no-no correction before typing", async () => {
    const out = await prepareComposeDictationText(
      "I will meet you tomorrow no no day after tomorrow",
    );
    expect(out.text.toLowerCase()).toContain("day after tomorrow");
    expect(out.text.toLowerCase()).not.toMatch(/tomorrow\.?\s+no/);
  });

  it("applies personal voice memory (nor → Noor)", async () => {
    const out = await prepareComposeDictationText("nor please check this");
    expect(out.text).toContain("Noor");
  });

  it("revises clause when 'no, just text me at 10' replaces 9 o'clock", async () => {
    const out = await prepareComposeDictationText(
      "I will tell you one thing, just text me at 9 o'clock, no, just text me at 10",
    );
    expect(out.text.toLowerCase()).toContain("10");
    expect(out.text.toLowerCase()).not.toMatch(/9\s*o/);
    expect(out.text.toLowerCase()).not.toMatch(/\bno\b/);
  });
});

describe("resolveGmailComposeDictationText", () => {
  beforeEach(() => {
    isGmailComposeFocused.mockReturnValue(false);
  });

  it("returns corrected text when Gmail compose is focused", async () => {
    isGmailComposeFocused.mockReturnValue(true);
    const { resolveGmailComposeDictationText } = await import(
      "../../automation/adapters/gmail/gmailComposeDictation.js"
    );
    const text = await resolveGmailComposeDictationText(
      "hello john can you send the report tomorrow no no Friday",
    );
    expect(text?.toLowerCase()).toContain("friday");
    expect(text?.toLowerCase()).not.toMatch(/tomorrow\.?\s+no/);
  });

  it("returns null when Gmail compose is not focused", async () => {
    isGmailComposeFocused.mockReturnValue(false);
    const { resolveGmailComposeDictationText } = await import(
      "../../automation/adapters/gmail/gmailComposeDictation.js"
    );
    expect(await resolveGmailComposeDictationText("hello world")).toBeNull();
  });

  it("returns null for explicit new-email commands", async () => {
    isGmailComposeFocused.mockReturnValue(true);
    const { resolveGmailComposeDictationText } = await import(
      "../../automation/adapters/gmail/gmailComposeDictation.js"
    );
    expect(
      await resolveGmailComposeDictationText("write email to bob@gmail.com"),
    ).toBeNull();
  });
});
