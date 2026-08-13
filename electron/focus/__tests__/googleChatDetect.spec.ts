import { describe, expect, it } from "vitest";
import { isGoogleChatWindowTitle } from "../../focus/focusContext.js";

describe("Google Chat detection", () => {
  it("matches Google Chat tab titles", () => {
    expect(isGoogleChatWindowTitle("Google Chat")).toBe(true);
    expect(
      isGoogleChatWindowTitle("EGC India Shopping club - Chat - Google Chrome"),
    ).toBe(true);
  });

  it("rejects unrelated chat pages", () => {
    expect(isGoogleChatWindowTitle("ChatGPT - Google Chrome")).toBe(false);
    expect(isGoogleChatWindowTitle("(60) WhatsApp - Google Chrome")).toBe(false);
    expect(isGoogleChatWindowTitle("Untitled - Notepad")).toBe(false);
  });
});
