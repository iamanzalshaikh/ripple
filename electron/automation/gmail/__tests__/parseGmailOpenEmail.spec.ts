import { describe, expect, it } from "vitest";
import {
  buildGmailSenderSearchUrl,
  parseGmailOpenEmailCommand,
} from "../parseGmailOpenEmail.js";
import { parseDesktopIntent } from "../../voice/nlu/pipeline.js";
import { parseGraphOpenCommand } from "../../desktop/parseGraphOpenCommand.js";

describe("parseGmailOpenEmailCommand", () => {
  it("parses open email from sender", () => {
    const intent = parseGmailOpenEmailCommand("Open a email from Naukri Campus");
    expect(intent).toEqual({
      kind: "open_gmail_email",
      senderQuery: "Naukri Campus",
    });
  });

  it("routes via pipeline before desktop item search", () => {
    const parsed = parseDesktopIntent("Open a email from Naukri Campus");
    expect(parsed?.intent.kind).toBe("open_gmail_email");
    if (parsed?.intent.kind === "open_gmail_email") {
      expect(parsed.intent.senderQuery).toBe("Naukri Campus");
    }
  });

  it("builds Gmail search URL", () => {
    const url = buildGmailSenderSearchUrl("Naukri Campus");
    expect(url).toContain("mail.google.com");
    expect(decodeURIComponent(url)).toMatch(/from:Naukri/i);
  });

  it("graph open does not steal gmail email-from commands", () => {
    expect(parseGraphOpenCommand("Open email from Naukri Campus")).toBeNull();
  });
});
