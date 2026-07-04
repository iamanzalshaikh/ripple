import { describe, expect, it } from "vitest";
import {
  buildGmailSenderSearchUrl,
  buildGmailSubjectSearchUrl,
  buildGmailAttachmentSearchUrl,
  parseGmailOpenEmailBySubjectCommand,
  parseGmailOpenEmailCommand,
  parseGmailOpenEmailFromCommand,
} from "../parseGmailOpenEmail.js";
import { parseDesktopIntent } from "../../voice/nlu/pipeline.js";
import { parseGraphOpenCommand } from "../../desktop/parseGraphOpenCommand.js";

describe("parseGmailOpenEmailFromCommand", () => {
  it("parses open email from sender", () => {
    const intent = parseGmailOpenEmailFromCommand("Open a email from Naukri Campus");
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

  it("builds Gmail sender search URL", () => {
    const url = buildGmailSenderSearchUrl("Naukri Campus");
    expect(url).toContain("mail.google.com");
    expect(decodeURIComponent(url)).toMatch(/from:Naukri/i);
  });

  it("graph open does not steal gmail email-from commands", () => {
    expect(parseGraphOpenCommand("Open email from Naukri Campus")).toBeNull();
  });
});

describe("parseGmailOpenAttachmentCommand", () => {
  it("parses open gmail thread with pdf attached", () => {
    const intent = parseGmailOpenEmailCommand(
      "Open Gmail thread with pdf attached",
    );
    expect(intent?.attachmentQuery).toBe("pdf");
    expect(intent?.senderQuery).toBeUndefined();
  });

  it("routes via pipeline before file semantic search", () => {
    const parsed = parseDesktopIntent("Open Gmail thread with pdf attached");
    expect(parsed?.intent.kind).toBe("open_gmail_email");
    if (parsed?.intent.kind === "open_gmail_email") {
      expect(parsed.intent.attachmentQuery).toBe("pdf");
    }
  });

  it("builds Gmail attachment search URL", () => {
    const url = buildGmailAttachmentSearchUrl("pdf");
    expect(decodeURIComponent(url)).toMatch(/has:attachment/i);
  });
});

describe("parseGmailOpenEmailBySubjectCommand", () => {
  it("parses open the X email", () => {
    const intent = parseGmailOpenEmailBySubjectCommand(
      "Open the Naukri shortlist email",
    );
    expect(intent).toEqual({
      kind: "open_gmail_email",
      subjectQuery: "Naukri shortlist",
    });
  });

  it("parses open email about subject", () => {
    const intent = parseGmailOpenEmailBySubjectCommand(
      "Open email about job shortlist",
    );
    expect(intent?.subjectQuery).toBe("job shortlist");
  });

  it("prefers from over subject when both could match", () => {
    const intent = parseGmailOpenEmailCommand("Open email from MongoDB Atlas");
    expect(intent?.senderQuery).toBe("MongoDB Atlas");
    expect(intent?.subjectQuery).toBeUndefined();
  });

  it("routes subject via pipeline", () => {
    const parsed = parseDesktopIntent("Open the MongoDB Atlas email");
    expect(parsed?.intent.kind).toBe("open_gmail_email");
    if (parsed?.intent.kind === "open_gmail_email") {
      expect(parsed.intent.subjectQuery).toBe("MongoDB Atlas");
    }
  });

  it("builds Gmail subject search URL", () => {
    const url = buildGmailSubjectSearchUrl("Naukri shortlist");
    expect(url).toContain("mail.google.com");
    expect(decodeURIComponent(url)).toMatch(/subject:Naukri/i);
  });

  it("graph open does not steal subject email commands", () => {
    expect(parseGraphOpenCommand("Open the Naukri shortlist email")).toBeNull();
  });
});
