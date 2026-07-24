import { beforeEach, describe, expect, it, vi } from "vitest";

const isEditableFocused = vi.fn(async () => false);
const isWhatsAppTabActive = vi.fn(() => false);
const isGmailComposeFocused = vi.fn(() => false);
const isInstagramTabActive = vi.fn((..._args: unknown[]) => false);
const getFocusContext = vi.fn(() => ({
  processName: "notepad",
  windowTitle: "Untitled - Notepad",
}));
const isRippleApplicationWindow = vi.fn(() => false);
const prepareComposeDictationText = vi.fn(async (raw: string) => ({
  text: raw,
  kind: "literal",
}));

vi.mock("../../planner/executionSync.js", () => ({
  isEditableFocused: (...args: unknown[]) => isEditableFocused(...args),
}));

vi.mock("../../../focus/focusContext.js", () => ({
  isWhatsAppTabActive: (...args: unknown[]) => isWhatsAppTabActive(...args),
  isGmailComposeFocused: (...args: unknown[]) => isGmailComposeFocused(...args),
  isInstagramTabActive: (...args: unknown[]) => isInstagramTabActive(...args),
  getFocusContext: (...args: unknown[]) => getFocusContext(...args),
  isRippleApplicationWindow: (...args: unknown[]) =>
    isRippleApplicationWindow(...args),
}));

vi.mock("../prepareComposeText.js", () => ({
  prepareComposeDictationText: (...args: unknown[]) =>
    prepareComposeDictationText(...args),
}));

vi.mock("../../../automation/adapters/whatsapp/whatsappVoiceOverride.js", () => ({
  looksLikeRippleOsCommand: (cmd: string) =>
    /^(?:open|close|launch|select\s+all|explain)\b/i.test(cmd.trim()),
}));

vi.mock("../../../automation/commandIntent.js", () => ({
  isEditOrRephraseCommand: (cmd: string) =>
    /\bmake\s+(?:it|this)\s+more\b/i.test(cmd),
}));

vi.mock("../../../automation/voice/normalizeTranscript.js", () => ({
  normalizeTranscript: (s: string) => s,
}));

describe("resolveFocusedFieldDictationText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isEditableFocused.mockResolvedValue(true);
    isWhatsAppTabActive.mockReturnValue(false);
    isGmailComposeFocused.mockReturnValue(false);
    isInstagramTabActive.mockReturnValue(false);
    isRippleApplicationWindow.mockReturnValue(false);
    getFocusContext.mockReturnValue({
      processName: "notepad",
      windowTitle: "Untitled - Notepad",
    });
    prepareComposeDictationText.mockImplementation(async (raw: string) => ({
      text: raw,
      kind: "literal",
    }));
  });

  it("types chatty speech into a focused editable field (Notepad)", async () => {
    const { resolveFocusedFieldDictationText } = await import(
      "../focusedFieldDictation.js"
    );
    const text = await resolveFocusedFieldDictationText(
      "Can we meet at 9 o'clock today, sorry 10 o'clock today",
    );
    expect(text).toContain("meet at 9");
    expect(prepareComposeDictationText).toHaveBeenCalled();
  });

  it("does not hijack OS / edit commands", async () => {
    const { resolveFocusedFieldDictationText } = await import(
      "../focusedFieldDictation.js"
    );
    expect(await resolveFocusedFieldDictationText("open chrome")).toBeNull();
    expect(
      await resolveFocusedFieldDictationText(
        "Select all and make it more confident",
      ),
    ).toBeNull();
  });

  it("defers to WhatsApp / Gmail dedicated resolvers", async () => {
    const { resolveFocusedFieldDictationText } = await import(
      "../focusedFieldDictation.js"
    );
    isWhatsAppTabActive.mockReturnValue(true);
    expect(await resolveFocusedFieldDictationText("hello there")).toBeNull();
  });

  it("defers to Instagram's dedicated DM compose path (regression: plain DM dictation was falling through here and getting rejected downstream)", async () => {
    const { resolveFocusedFieldDictationText } = await import(
      "../focusedFieldDictation.js"
    );
    isInstagramTabActive.mockReturnValue(true);
    expect(
      await resolveFocusedFieldDictationText("tell me what happened"),
    ).toBeNull();
    expect(prepareComposeDictationText).not.toHaveBeenCalled();
  });

  it("returns null when no editable focus", async () => {
    const { resolveFocusedFieldDictationText } = await import(
      "../focusedFieldDictation.js"
    );
    isEditableFocused.mockResolvedValue(false);
    expect(await resolveFocusedFieldDictationText("hello there")).toBeNull();
  });
});
