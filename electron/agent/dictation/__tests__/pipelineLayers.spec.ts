import { describe, expect, it, vi } from "vitest";
import {
  cleanupLevelForLayers,
  layersForCleanupLevel,
  parsePipelineLayers,
  serializePipelineLayers,
} from "../pipelineLayers.js";
import { rewriteDictationBuffer } from "../dictationRewrite.js";

vi.mock("../aiRewriteDictation.js", () => ({
  isDictationAiRewriteEnabled: () => false,
  aiRewriteDictation: vi.fn(async () => null),
  analyzeDictationCorrection: vi.fn(async () => null),
  generateDictationCorrection: vi.fn(async () => null),
}));

vi.mock("../../../storage/voiceCorrections.js", () => ({
  applyCorrectionsToUtterance: (text: string) => text,
}));

vi.mock("../../../storage/snippets.js", () => ({
  resolveSnippetTrigger: () => null,
}));

const { getStyleProfileForProcess } = vi.hoisted(() => ({
  getStyleProfileForProcess: vi.fn(() => "neutral"),
}));

vi.mock("../../../storage/styleProfiles.js", () => ({
  getStyleProfileForProcess: (...args: unknown[]) =>
    getStyleProfileForProcess(...args),
}));

describe("pipeline layer presets", () => {
  it("maps None / Light / Medium / High to independent flags", () => {
    expect(layersForCleanupLevel("none")).toEqual({
      transcribe: true,
      cleanup: false,
      format: false,
      context: false,
    });
    expect(layersForCleanupLevel("light")).toEqual({
      transcribe: true,
      cleanup: true,
      format: false,
      context: false,
    });
    expect(layersForCleanupLevel("medium")).toEqual({
      transcribe: true,
      cleanup: true,
      format: true,
      context: false,
    });
    expect(layersForCleanupLevel("high")).toEqual({
      transcribe: true,
      cleanup: true,
      format: true,
      context: true,
    });
  });

  it("round-trips JSON flags and detects custom mixes", () => {
    const custom = {
      transcribe: true as const,
      cleanup: false,
      format: true,
      context: false,
    };
    expect(parsePipelineLayers(serializePipelineLayers(custom))).toEqual(custom);
    expect(cleanupLevelForLayers(custom)).toBe("custom");
  });
});

describe("rewriteDictationBuffer respects layers", () => {
  const raw = "um I think we should go";

  it("None keeps fillers and skips punctuation", async () => {
    const out = await rewriteDictationBuffer({
      bufferText: raw,
      layers: layersForCleanupLevel("none"),
    });
    expect(out.finalText.toLowerCase()).toContain("um");
    expect(out.decisionLog.reason).not.toBe("ai_cleanup");
  });

  it("Light strips fillers without adding a period", async () => {
    const out = await rewriteDictationBuffer({
      bufferText: raw,
      layers: layersForCleanupLevel("light"),
    });
    expect(out.finalText.toLowerCase()).not.toContain("um");
    expect(out.finalText.endsWith(".")).toBe(false);
    expect(out.decisionLog.reason).toBe("filler_only");
  });

  it("Medium strips fillers and adds punctuation", async () => {
    const out = await rewriteDictationBuffer({
      bufferText: raw,
      layers: layersForCleanupLevel("medium"),
    });
    expect(out.finalText).toBe("I think we should go.");
    expect(out.decisionLog.reason).toBe("local_cleanup");
  });

  it("High context applies Formal per-app style", async () => {
    getStyleProfileForProcess.mockReturnValueOnce("formal");
    const out = await rewriteDictationBuffer({
      bufferText: "hey gotta ship this",
      layers: layersForCleanupLevel("high"),
      processName: "outlook",
    });
    expect(out.decisionLog.reason).toMatch(/style_formal/);
    expect(out.finalText.toLowerCase()).toContain("must");
  });
});
