import { describe, expect, it } from "vitest";
import { parseWhatsAppCommand } from "../../../adapters/whatsapp/parseWhatsAppCommand.js";
import { buildWhatsAppCommandResult } from "../../../adapters/whatsapp/whatsappCommand.js";
import {
  desktopBlockedMessage,
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../desktopIntentGuard.js";
import { parseDesktopIntent } from "../pipeline.js";
import { preprocessForNlu } from "../preprocess.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4.7 — NLU preprocess", () => {
  it.each([
    ["Download kholo", /open downloads/i],
    ["Download karo aur open mera resume", /open downloads and open my resume/i],
    ["डाउनलोड खोलो", /open downloads/i],
    ["व्हाट्सएप खोलो", /open whatsapp/i],
    ["Download kholo and resume open karo mera", /open downloads/i],
  ])('preprocesses "%s"', (input, expected) => {
    const { nlu } = preprocessForNlu(input);
    expect(nlu).toMatch(expected);
    expect(nlu.toLowerCase()).not.toContain("downloadsopen");
    expect(nlu.toLowerCase()).not.toContain("downloadskaro");
  });
});

describe("Phase 4 — desktop intent parsing", () => {
  it('parses "Download kholo" as open downloads folder', () => {
    const result = parseDesktopIntent("Download kholo");
    expect(result?.intent.kind).toBe("folder");
    if (result?.intent.kind === "folder") {
      expect(result.intent.folder).toBe("downloads");
    }
  });

  it('parses "Open calculator" as native app launch', () => {
    const result = parseDesktopIntent("Open calculator");
    expect(result?.intent.kind).toBe("launch_app");
    if (result?.intent.kind === "launch_app") {
      expect(result.intent.app.id).toBe("calculator");
    }
  });

  it('parses "Open my resume" as smart search', () => {
    const result = parseDesktopIntent("Open my resume");
    expect(result?.intent.kind).toBe("smart_search");
    if (result?.intent.kind === "smart_search") {
      expect(result.intent.label).toMatch(/resume/i);
    }
  });

  it('parses compound "Download karo aur open mera resume"', () => {
    const result = parseDesktopIntent("Download karo aur open mera resume");
    expect(result?.intent.kind).toBe("compound");
    if (result?.intent.kind === "compound") {
      expect(result.intent.steps).toHaveLength(2);
      expect(result.intent.steps[0]?.kind).toBe("folder");
      expect(result.intent.steps[1]?.kind).toBe("smart_search");
    }
  });

  it('parses Hindi "डाउनलोड खोलो" as downloads folder', () => {
    const result = parseDesktopIntent("डाउनलोड खोलो");
    expect(result?.intent.kind).toBe("folder");
  });

  it('parses "search Dr Fatima" as smart search', () => {
    const result = parseDesktopIntent("search Dr Fatima");
    expect(result?.intent.kind).toBe("smart_search");
  });
});

describe("Phase 4.7 — desktop intent guard", () => {
  it("blocks desktop-shaped Hinglish from backend routing", () => {
    expect(isLikelyDesktopCommand("Download kholo")).toBe(true);
  });

  it("detects regional Hindi script", () => {
    expect(isRegionalLanguageCommand("डाउनलोड खोलो")).toBe(true);
    expect(isLikelyDesktopCommand("डाउनलोड खोलो")).toBe(true);
  });

  it("returns helpful guided message for regional speech", () => {
    const msg = desktopBlockedMessage("डाउनलोड खोलो");
    expect(msg).toMatch(/Try saying:/);
    expect(msg).toMatch(/Download kholo/i);
  });
});

describe("Phase 4.7 — local WhatsApp", () => {
  it('parses "Open WhatsApp" as open intent', () => {
    expect(parseWhatsAppCommand("Open WhatsApp")).toEqual({ kind: "open" });
  });

  it("builds local workflow without backend OPEN_APP", () => {
    const result = buildWhatsAppCommandResult("Open WhatsApp");
    expect(result?.intent).toBe("workflow");
    expect(result?.actions?.[0]?.type).toBe("WORKFLOW");
    const steps = result?.actions?.[0]?.data?.steps as
      | { data?: { _whatsappBatch?: boolean; whatsappKind?: string } }[]
      | undefined;
    expect(steps?.[0]?.data?._whatsappBatch).toBe(true);
    expect(steps?.[0]?.data?.whatsappKind).toBe("open");
  });

  it('parses Hindi "व्हाट्सएप खोलो" as open', () => {
    expect(parseWhatsAppCommand("व्हाट्सएप खोलो")).toEqual({ kind: "open" });
  });
});
