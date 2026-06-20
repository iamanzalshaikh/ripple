import { describe, expect, it } from "vitest";
import { setFocusContext } from "../../../../focus/focusContext.js";
import { buildYouTubeCommandResult } from "../../../adapters/youtube/youtubeCommand.js";
import { parseYouTubeCommand } from "../../../adapters/youtube/parseYouTubeCommand.js";
import {
  extractContactName,
  extractMessageFromCommand,
  isWhatsAppMessagingCommand,
} from "../../../adapters/whatsapp/parseContact.js";
import { buildWhatsAppCommandResult } from "../../../adapters/whatsapp/whatsappCommand.js";
import {
  isContextualWhatsAppComposeCommand,
  resolveContextualComposeText,
} from "../../../adapters/whatsapp/parseWhatsAppCommand.js";
import { parseDesktopIntent } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

function mockWhatsAppFocus(): void {
  setFocusContext({
    hwnd: 1,
    processName: "chrome",
    windowTitle: "(67) WhatsApp",
    capturedAt: Date.now(),
    isGmail: false,
    isWhatsApp: true,
    isSlack: false,
    isNotion: false,
    isYouTube: false,
    isLinkedIn: false,
    isInstagram: false,
    isBrowser: true,
    activeTabUrl: "https://web.whatsapp.com/",
  });
}

describe("Phase 3.5 — web app local commands", () => {
  it("youtube open", () => {
    expect(parseYouTubeCommand("Open YouTube")?.kind).toBe("open");
    const result = buildYouTubeCommandResult("Open YouTube");
    expect(result?.intent).toBe("workflow");
    expect(result?.actions?.[0]?.data?.steps?.[0]?.data?._youtubeBatch).toBe(
      true,
    );
  });

  it("youtube search", () => {
    const intent = parseYouTubeCommand("Search YouTube for React hooks");
    expect(intent?.kind).toBe("search");
    if (intent?.kind === "search") {
      expect(intent.query.toLowerCase()).toMatch(/react/);
    }
  });

  it("whatsapp messaging detected", () => {
    expect(isWhatsAppMessagingCommand("Message Noor hello")).toBe(true);
    expect(extractContactName("Message Noor hello")).toMatch(/noor/i);
  });

  it("whatsapp Dr. Fatima asking — full contact name", () => {
    const cmd = "Message Dr. Fatima asking how are you";
    expect(extractContactName(cmd)).toBe("Dr. Fatima");
    expect(extractMessageFromCommand(cmd)).toBe("how are you");
  });

  it("whatsapp Urdu search and ask — maps to Dr. Fatima", () => {
    mockWhatsAppFocus();
    const cmd = "سرچ ڈاکٹر فاطمہ اور پوچھیں کہ آپ کس طرح ہیں";
    expect(isWhatsAppMessagingCommand(cmd)).toBe(true);
    expect(extractContactName(cmd)).toBe("Dr. Fatima");
    expect(parseYouTubeCommand(cmd)).toBeNull();
  });

  it("whatsapp search on whatsapp — English", () => {
    mockWhatsAppFocus();
    expect(extractContactName("Search Dr. Fatima on WhatsApp")).toBe("Dr. Fatima");
    expect(buildWhatsAppCommandResult("Search Dr. Fatima on WhatsApp")?.intent).toBe(
      "workflow",
    );
  });

  it("whatsapp message workflow", () => {
    const result = buildWhatsAppCommandResult("Message Noor hello");
    expect(result?.intent).toBe("workflow");
    const step = result?.actions?.[0]?.data?.steps?.[0];
    expect(step?.type).toBe("INSERT_TEXT");
    expect(step?.data?.recipient).toMatch(/noor/i);
  });

  it("whatsapp contextual compose — plain speech in open chat", () => {
    mockWhatsAppFocus();
    expect(isContextualWhatsAppComposeCommand("How are you today")).toBe(true);
    expect(isContextualWhatsAppComposeCommand("Search how are you")).toBe(true);
    expect(resolveContextualComposeText("Search how are you")).toBe("how are you");
    expect(isContextualWhatsAppComposeCommand("Search Ammi1 and say hi")).toBe(
      false,
    );
    expect(isContextualWhatsAppComposeCommand("Open Calculator")).toBe(false);
  });

  it("desktop focus does not stick whatsapp for calculator", () => {
    setFocusContext({
      hwnd: 2,
      processName: "explorer",
      windowTitle: "Program Manager",
      capturedAt: Date.now(),
      isGmail: false,
      isWhatsApp: false,
      isSlack: false,
      isNotion: false,
      isYouTube: false,
      isLinkedIn: false,
      isInstagram: false,
      isBrowser: false,
    });
    expect(buildWhatsAppCommandResult("Open Calculator")).toBeNull();
  });

  it("whatsapp open is not messaging", () => {
    expect(isWhatsAppMessagingCommand("Open WhatsApp")).toBe(false);
  });
});

describe("Phase 3.5 — web apps not desktop", () => {
  it("gmail does not parse as native desktop folder", () => {
    const result = parseDesktopIntent("Open gmail");
    expect(result?.intent.kind).not.toBe("folder");
  });
});
