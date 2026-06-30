import { describe, expect, it, vi } from "vitest";

vi.mock("../graphLookup.js", () => ({
  graphLookup: vi.fn(() => null),
}));

vi.mock("../../desktop/nativeAppRegistry.js", () => ({
  resolveNativeApp: vi.fn((spoken: string) => {
    if (spoken.toLowerCase().includes("code")) {
      return { id: "vscode", label: "Visual Studio Code", launch: "code" };
    }
    return null;
  }),
  findNativeAppById: vi.fn(() => undefined),
}));

describe("retrieveAppCandidates P5", () => {
  it("returns native app registry hits", async () => {
    const { retrieveAppCandidates } = await import("../retrieveAppCandidates.js");
    const hits = retrieveAppCandidates("open vscode");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe("vscode");
  });
});
