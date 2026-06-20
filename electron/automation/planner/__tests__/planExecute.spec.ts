import { describe, expect, it, vi, beforeEach } from "vitest";
import { useFreshNluCache } from "../../voice/nlu/__tests__/testHelpers.js";

useFreshNluCache();

const fetchMock = vi.fn();

vi.mock("../../voice/nlu/llmIntent.js", () => ({
  fetchDesktopIntentFromLlm: (...args: unknown[]) => fetchMock(...args),
}));

vi.mock("../../retriever/retriever.js", () => ({
  retrieveFileCandidates: vi.fn().mockResolvedValue([]),
}));

describe("planDesktopCommand P0 — GPT planner", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(null);
  });

  it("uses GPT when fast path and retriever miss", async () => {
    fetchMock.mockResolvedValue({
      action: "create_folder",
      entities: { item_name: "followers", from_folder: "downloads" },
      confidence: 0.92,
    });

    const { planDesktopCommand } = await import("../planExecute.js");
    const result = await planDesktopCommand(
      "desktop action create special folder alpha999 in downloads",
      async () => "test-token",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result?.kind).toBe("payload");
    if (result?.kind === "payload") {
      expect(result.source).toBe("gpt");
      expect(result.payload.intent).toBe("workflow");
    }
  });

  it("returns guided not_found when GPT returns null", async () => {
    fetchMock.mockResolvedValue(null);

    const { planDesktopCommand } = await import("../planExecute.js");
    const result = await planDesktopCommand(
      "zzunique99 create folder datavault in downloads",
      async () => "test-token",
    );

    expect(result?.kind).toBe("not_found");
    if (result?.kind === "not_found") {
      expect(result.hint).toMatch(/Try saying:/);
      expect(result.hint).not.toMatch(/I didn't understand\./i);
    }
  });

  it("returns guided message when not authenticated", async () => {
    const { planDesktopCommand } = await import("../planExecute.js");
    const result = await planDesktopCommand(
      "zzunique99 create folder datavault in downloads",
      async () => null,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.kind).toBe("not_found");
    if (result?.kind === "not_found") {
      expect(result.hint).toMatch(/OPENAI_API_KEY/);
    }
  });

  it("still uses fast path without GPT", async () => {
    const { planDesktopCommand } = await import("../planExecute.js");
    const result = await planDesktopCommand("Open downloads", async () => "t");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.kind).toBe("payload");
    if (result?.kind === "payload") {
      expect(result.source).toBe("fast");
    }
  });
});
