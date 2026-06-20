import { describe, expect, it } from "vitest";
import { parseReferentialSend } from "../parseReferentialWhatsApp.js";
import { parseSendResumeCompound } from "../compoundParse.js";
import { parseDesktopIntent } from "../pipeline.js";
import {
  getRecentConversationTurns,
  recordConversationTurn,
} from "../../../../storage/conversationContext.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("P2 — referential send (named contact)", () => {
  it.each([
    ["Send it to Noor", "Noor"],
    ["share it with Dr. Fatima", "Dr. Fatima"],
    ["Send that file to Ammi1", "Ammi1"],
    ["isko Noor ko bhejo", "Noor"],
  ])('"%s" → contact %s', (phrase, contact) => {
    const intent = parseReferentialSend(phrase);
    expect(intent?.kind).toBe("referential_send");
    if (intent?.kind === "referential_send") {
      expect(intent.contact).toBe(contact);
      expect(intent.mode).toBe("send_file");
    }
  });

  it("pronoun send uses last_contact marker", () => {
    const intent = parseReferentialSend("send it to him");
    expect(intent?.contact).toBe("__last_contact__");
  });
});

describe("P2 — compound send resume", () => {
  it("parses send latest resume to Noor", () => {
    const compound = parseSendResumeCompound("Send latest resume to Noor");
    expect(compound?.kind).toBe("compound");
    if (compound?.kind === "compound") {
      expect(compound.steps).toHaveLength(2);
      expect(compound.steps[0]?.kind).toBe("smart_search");
      expect(compound.steps[1]?.kind).toBe("referential_send");
      if (compound.steps[1]?.kind === "referential_send") {
        expect(compound.steps[1].contact).toBe("Noor");
      }
    }
  });

  it("pipeline parses open resume and send it to Noor", () => {
    const result = parseDesktopIntent(
      "Open my resume and send it to Noor",
    );
    expect(result?.intent.kind).toBe("compound");
    if (result?.intent.kind === "compound") {
      expect(result.intent.steps.length).toBe(2);
      expect(result.intent.steps[1]?.kind).toBe("referential_send");
    }
  });

  it("pipeline parses open folder then send on WhatsApp", () => {
    const result = parseDesktopIntent(
      "Open Anzal folder in downloads and send it to Dr. Fatima on WhatsApp",
    );
    expect(result?.intent.kind).toBe("compound");
    if (result?.intent.kind === "compound") {
      expect(result.intent.steps).toHaveLength(2);
      expect(result.intent.steps[0]?.kind).toBe("item");
      if (result.intent.steps[0]?.kind === "item") {
        expect(result.intent.steps[0].name).toMatch(/anzal/i);
        expect(result.intent.steps[0].parent).toBe("downloads");
      }
      expect(result.intent.steps[1]?.kind).toBe("referential_send");
      if (result.intent.steps[1]?.kind === "referential_send") {
        expect(result.intent.steps[1].contact).toMatch(/fatima/i);
      }
    }
  });

  it('parses "send to" without "it" as referential send', () => {
    const intent = parseReferentialSend("send to Dr. Fatima on WhatsApp");
    expect(intent?.contact).toMatch(/fatima/i);
  });

  it("pipeline parses open Anzal and send to (no it)", () => {
    const result = parseDesktopIntent(
      "Open Anzal in Downloads and send to Dr. Fatima on WhatsApp",
    );
    expect(result?.intent.kind).toBe("compound");
    if (result?.intent.kind === "compound") {
      expect(result.intent.steps[0]?.kind).toBe("item");
      if (result.intent.steps[0]?.kind === "item") {
        expect(result.intent.steps[0].name).toBe("Anzal");
        expect(result.intent.steps[0].parent).toBe("downloads");
      }
      expect(result.intent.steps[1]?.kind).toBe("referential_send");
    }
  });

  it("send folder from downloads to contact is compound (not WA text)", () => {
    const result = parseDesktopIntent(
      "Send Anzal folder from downloads to Dr. Fatima",
    );
    expect(result?.intent.kind).toBe("compound");
    if (result?.intent.kind === "compound") {
      expect(result.intent.steps).toHaveLength(2);
      expect(result.intent.steps[0]?.kind).toBe("item");
      if (result.intent.steps[0]?.kind === "item") {
        expect(result.intent.steps[0].name).toBe("Anzal");
      }
      if (result.intent.steps[1]?.kind === "referential_send") {
        expect(result.intent.steps[1].contact).toBe("Dr. Fatima");
      }
    }
  });

  it("strips WhatsApp to prefix from contact", () => {
    const result = parseDesktopIntent(
      "Send Anzal folder from downloads to WhatsApp to Dr.Fatim",
    );
    expect(result?.intent.kind).toBe("compound");
    if (result?.intent.kind === "compound") {
      const send = result.intent.steps[1];
      if (send?.kind === "referential_send") {
        expect(send.contact).toMatch(/fatim/i);
        expect(send.contact.toLowerCase()).not.toContain("whatsapp");
      }
    }
  });
});

describe("P2 — conversation_turn storage", () => {
  it("records and retrieves recent turns", () => {
    recordConversationTurn({
      command: "Open downloads",
      intent: "workflow",
      outcome: "success",
    });
    const turns = getRecentConversationTurns(3);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns[0]?.command).toBe("Open downloads");
  });
});
