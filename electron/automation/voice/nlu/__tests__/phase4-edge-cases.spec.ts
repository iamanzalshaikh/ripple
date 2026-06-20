import { describe, expect, it } from "vitest";
import { nativeIntentFromLlmPlan } from "../intentFromLlm.js";
import {
  isDesktopIntent,
  parseDesktopIntent,
} from "../pipeline.js";
import {
  isLikelyDesktopCommand,
  isRegionalLanguageCommand,
} from "../desktopIntentGuard.js";
import { parseDesktopIntent as pipelineParse } from "../pipeline.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Phase 4 — negative / edge cases", () => {
  it("empty command returns null", () => {
    expect(parseDesktopIntent("")).toBeNull();
    expect(parseDesktopIntent("   ")).toBeNull();
  });

  it("gibberish does not parse as desktop", () => {
    expect(isDesktopIntent("asdf qwerty zxcv")).toBe(false);
  });

  it("generic AI question not desktop-shaped", () => {
    expect(isLikelyDesktopCommand("Write me a poem about cats")).toBe(false);
    expect(isLikelyDesktopCommand("What is the weather today")).toBe(false);
  });

  it("english hello not regional", () => {
    expect(isRegionalLanguageCommand("Hello world")).toBe(false);
  });

  it("open browser alone is not native app (no browser in registry as launch)", () => {
    const result = pipelineParse("Open browser");
    expect(result).toBeNull();
  });

  it("compound with single part does not compound", () => {
    const result = parseDesktopIntent("Open downloads");
    expect(result?.intent.kind).not.toBe("compound");
  });

  it("whitespace and punctuation normalized", () => {
    const result = parseDesktopIntent("  Open   Downloads.  ");
    expect(result?.intent.kind).toBe("folder");
  });
});

describe("Phase 4.6 — LLM intent mapper", () => {
  it("maps open_folder plan", () => {
    const intent = nativeIntentFromLlmPlan({
      action: "open_folder",
      entities: { folder: "downloads" },
      confidence: 0.9,
    });
    expect(intent?.kind).toBe("folder");
    if (intent?.kind === "folder") {
      expect(intent.folder).toBe("downloads");
    }
  });

  it("maps smart_search resume", () => {
    const intent = nativeIntentFromLlmPlan({
      action: "smart_search",
      entities: { file_token: "resume" },
      confidence: 0.9,
    });
    expect(intent?.kind).toBe("smart_search");
  });

  it("maps recall_last", () => {
    const intent = nativeIntentFromLlmPlan({
      action: "recall_last",
      entities: { recall_target: "auto" },
      confidence: 0.85,
    });
    expect(intent?.kind).toBe("recall_memory");
  });

  it("rejects none action", () => {
    expect(
      nativeIntentFromLlmPlan({
        action: "none",
        entities: {},
        confidence: 0.99,
      }),
    ).toBeNull();
  });

  it("maps delete_file with folder", () => {
    const intent = nativeIntentFromLlmPlan({
      action: "delete_file",
      entities: { item_name: "temp.txt", from_folder: "downloads" },
      confidence: 0.9,
    });
    expect(intent?.kind).toBe("delete_file");
  });
});

describe("Phase 4 — production regression (terminal log failures)", () => {
  it.each([
    "Download kholo",
    "Download karo aur open mera resume",
    "डाउनलोड खोलो",
  ])('regression: "%s" parses locally', (cmd) => {
    expect(parseDesktopIntent(cmd)).not.toBeNull();
    expect(isLikelyDesktopCommand(cmd)).toBe(true);
  });

  it("regression: Open WhatsApp is local not desktop folder", () => {
    expect(parseDesktopIntent("Open WhatsApp")).toBeNull();
  });
});
