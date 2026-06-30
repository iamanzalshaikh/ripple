import { describe, expect, it } from "vitest";
import { normalizeSpokenInstagramUsername } from "../instagramUsername.js";
import { parseInstagramCommand } from "../parseInstagramCommand.js";

describe("instagramUsername", () => {
  it("normalizes spoken underscore and dots", () => {
    expect(normalizeSpokenInstagramUsername("underscore xx dot fx dot 66")).toBe(
      "_xx.fx.66",
    );
    expect(normalizeSpokenInstagramUsername("underscope xx.fx.66")).toBe("xx.fx.66");
  });
});

describe("parseInstagramCommand handles", () => {
  it("message handle with dots and and ask", () => {
    const intent = parseInstagramCommand(
      "Message underscope xx.fx.66 and ask how are you",
    );
    expect(intent?.kind).toBe("message");
    if (intent?.kind === "message") {
      expect(intent.username).toBe("xx.fx.66");
      expect(intent.text.toLowerCase()).toContain("how are you");
    }
  });

  it("search handle on instagram and say", () => {
    const intent = parseInstagramCommand(
      "Search xx.fx.66 on Instagram and say hey there",
    );
    expect(intent?.kind).toBe("message");
    if (intent?.kind === "message") {
      expect(intent.username).toBe("xx.fx.66");
      expect(intent.text).toBe("hey there");
    }
  });
});

describe("parseLinkedInCommand duplicate STT", () => {
  it("extracts person from duplicated search phrase", async () => {
    const { parseLinkedInCommand } = await import(
      "../../linkedin/parseLinkedInCommand.js"
    );
    const intent = parseLinkedInCommand(
      "Search Faiz Sayyed on LinkedIn, search Faiz Sayyed on LinkedIn",
    );
    expect(intent?.kind).toBe("search_people");
    if (intent?.kind === "search_people") {
      expect(intent.query).toBe("Faiz Sayyed");
    }
  });
});

describe("actionExpander linkedin batch", () => {
  it("prefers linkedin batch over desktop smart search", async () => {
    const { expandWorkflowSteps } = await import("../../../workflow/actionExpander.js");
    const { setLastVoiceCommand } = await import("../../../../state/lastCommand.js");

    setLastVoiceCommand(
      "Search Faiz Sayyed on LinkedIn, search Faiz Sayyed on LinkedIn",
    );

    const expanded = expandWorkflowSteps([
      {
        type: "NOOP",
        status: "pending",
        data: {
          _linkedinBatch: true,
          linkedinKind: "search_people",
          query: "Faiz Sayyed",
        },
      },
    ]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.action.data?._linkedinBatch).toBe(true);
    expect(expanded[0]?.action.data?.desktopKind).toBeUndefined();
  });

  it("prefers whatsapp insert batch over instagram expand", async () => {
    const { expandWorkflowSteps } = await import("../../../workflow/actionExpander.js");
    const { setLastVoiceCommand } = await import("../../../../state/lastCommand.js");

    setLastVoiceCommand("Message Dr. Fatima and ask how are you");

    const expanded = expandWorkflowSteps([
      {
        type: "INSERT_TEXT",
        status: "pending",
        data: {
          _whatsappBatch: true,
          recipient: "Dr. Fatima",
          text: "how are you",
          send: false,
          command: "Message Dr. Fatima and ask how are you",
        },
      },
    ]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.action.type).toBe("SEARCH_CONTACT");
    expect(expanded[0]?.action.data?._whatsappBatch).toBe(true);
    expect(expanded[0]?.action.data?.recipient).toBe("Dr. Fatima");
  });

  it("does not treat Dr Fatima message as instagram", async () => {
    const { isInstagramCommand } = await import("../parseInstagramCommand.js");
    expect(isInstagramCommand("Message Dr. Fatima and ask how are you")).toBe(false);
  });
});
