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
  searchWindowsByExtension: vi.fn(async () => []),
}));

vi.mock("../searchRoots.js", () => ({
  getRetrieverSearchPaths: () => [
    "C:\\Users\\me\\Downloads",
    "C:\\Users\\me\\Documents",
    "C:\\Users\\me\\Desktop",
  ],
  powershellSearchRootsLiteral: () =>
    "'C:\\Users\\me\\Downloads','C:\\Users\\me\\Documents','C:\\Users\\me\\Desktop'",
  psEscapePath: (p: string) => p.replace(/'/g, "''"),
}));

vi.mock("../../desktop/openFolder.js", () => ({
  resolveFolderPath: (key: string) => {
    if (key === "downloads") return "C:\\Users\\me\\Downloads";
    if (key === "documents") return "C:\\Users\\me\\Documents";
    return "C:\\Users\\me\\Desktop";
  },
}));

vi.mock("../../desktop/diskSearch.js", () => ({
  searchDiskByNameOnly: vi.fn(() => []),
}));

vi.mock("../../../storage/fileIndex.js", () => ({
  searchIndexByName: vi.fn(() => []),
  queryModifiedInRange: vi.fn(() => []),
  queryLatestByExtension: vi.fn(() => []),
  upsertFileIndexPath: vi.fn(),
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
    const { upsertFileIndexPath } = await import("../../../storage/fileIndex.js");

    vi.mocked(searchIndexByName).mockReturnValue([
      "C:\\Users\\me\\Documents\\old-resume.pdf",
    ]);

    const candidates = await retrieveFileCandidates({
      phrase: "resume",
      token: "resume",
    });

    expect(searchWindowsShell).toHaveBeenCalledWith("resume", {});
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.source).toBe("windows_search");
    expect(candidates.some((c) => c.source === "index")).toBe(true);
    expect(upsertFileIndexPath).toHaveBeenCalled();
  });

  it("applies parent folder hint without dropping all hits", async () => {
    const { retrieveFileCandidates } = await import("../retriever.js");
    const { searchWindowsShell } = await import("../../desktop/windowsSearch.js");

    vi.mocked(searchWindowsShell).mockResolvedValue([
      "C:\\Users\\me\\Downloads\\resume.pdf",
      "C:\\Users\\me\\Documents\\resume.pdf",
    ]);

    const candidates = await retrieveFileCandidates({
      phrase: "resume in downloads",
      token: "resume",
      parentFolder: "downloads",
    });

    expect(candidates.every((c) => c.path.toLowerCase().includes("downloads"))).toBe(
      true,
    );
  });

  it("passes time range for 3 months ago pdf queries", async () => {
    const { retrieveFileCandidates } = await import("../retriever.js");
    const { queryModifiedInRange } = await import("../../../storage/fileIndex.js");
    const { searchWindowsByExtension } = await import(
      "../../desktop/windowsSearch.js"
    );

    await retrieveFileCandidates({
      phrase: "pdf I edited 3 months ago",
      timeRange: "3_months_ago",
      extension: "pdf",
    });

    expect(queryModifiedInRange).toHaveBeenCalled();
    expect(searchWindowsByExtension).toHaveBeenCalledWith("pdf");
  });

  it("skips disk walk when windows search has enough hits", async () => {
    const { retrieveFileCandidates } = await import("../retriever.js");
    const { searchWindowsShell } = await import("../../desktop/windowsSearch.js");
    const { searchDiskByNameOnly } = await import("../../desktop/diskSearch.js");

    vi.mocked(searchWindowsShell).mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => `C:\\Users\\me\\Downloads\\f${i}.pdf`),
    );

    await retrieveFileCandidates({
      phrase: "pdf",
      token: "pdf",
    });

    expect(searchDiskByNameOnly).not.toHaveBeenCalled();
  });
});
