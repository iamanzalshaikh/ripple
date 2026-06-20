import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  planStepFromIntent,
  smartQueryToRetrieveInput,
} from "../retrieveForPlan.js";

vi.mock("../graphLookup.js", () => ({
  graphLookup: vi.fn(() => null),
}));

vi.mock("../../../storage/capabilityCache.js", () => ({
  getCapabilityCacheHit: vi.fn(() => null),
}));

vi.mock("../../desktop/aliasRegistry.js", () => ({
  resolveAlias: vi.fn(() => null),
}));

vi.mock("../../desktop/windowsSearch.js", () => ({
  searchWindowsIndex: vi.fn(async () => []),
  searchWindowsShell: vi.fn(async () => [
    "C:\\Users\\me\\Downloads\\resume.pdf",
  ]),
}));

vi.mock("../../desktop/diskSearch.js", () => ({
  searchDiskByNameOnly: vi.fn(() => []),
}));

vi.mock("../../../storage/fileIndex.js", () => ({
  searchIndexByName: vi.fn(() => []),
  queryModifiedInRange: vi.fn(() => []),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({
      mtimeMs: Date.now(),
      isFile: () => true,
      isDirectory: () => false,
    })),
  };
});

describe("retrieveForPlan P5", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("maps item intent to open_item step", () => {
    const step = planStepFromIntent(
      { kind: "item", name: "resume", parent: "downloads" },
      "open resume in downloads",
    );
    expect(step).toEqual({
      kind: "open_item",
      phrase: "open resume in downloads",
      token: "resume",
      parentFolder: "downloads",
    });
  });

  it("maps smart_search yesterday pdf", () => {
    const input = smartQueryToRetrieveInput(
      { type: "modified_yesterday", extension: "pdf" },
      "yesterday_pdf",
    );
    expect(input.timeRange).toBe("yesterday");
    expect(input.extension).toBe("pdf");
  });

  it("retrieve chain prefers windows_search before index", async () => {
    const { retrieveFileCandidates } = await import("../retriever.js");
    const { searchWindowsShell } = await import("../../desktop/windowsSearch.js");
    const { searchIndexByName } = await import("../../../storage/fileIndex.js");

    vi.mocked(searchIndexByName).mockReturnValue([
      "C:\\Users\\me\\Documents\\old-resume.pdf",
    ]);

    const candidates = await retrieveFileCandidates({
      phrase: "resume",
      token: "resume",
    });

    expect(searchWindowsShell).toHaveBeenCalledWith("resume");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.source).toBe("windows_search");
    expect(candidates.some((c) => c.source === "index")).toBe(true);
  });
});
