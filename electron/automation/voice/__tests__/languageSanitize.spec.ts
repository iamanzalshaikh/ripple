import { describe, expect, it, vi } from "vitest";
import {
  languageHintForStt,
  sanitizeWhisperLanguageTag,
} from "../transcriptPipeline.js";

describe("sanitizeWhisperLanguageTag", () => {
  it("overrides sindhi/urdu when the transcript is plain English", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(
      sanitizeWhisperLanguageTag(
        "Hello, I'm missing you so much. Please come back.",
        "sindhi",
      ),
    ).toBe("en");
    expect(
      sanitizeWhisperLanguageTag(
        "Please come back baby. Love you.",
        "ur",
      ),
    ).toBe("en");
    warn.mockRestore();
  });

  it("keeps urdu when the text is not latin english", () => {
    expect(sanitizeWhisperLanguageTag("آپ کیسے ہیں", "ur")).toBe("ur");
  });

  it("drops auto and empty tags", () => {
    expect(languageHintForStt("auto")).toBeUndefined();
    expect(languageHintForStt("")).toBeUndefined();
    expect(languageHintForStt("en")).toBe("en");
  });
});
