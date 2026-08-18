import { describe, expect, it, vi } from "vitest";
import { applyFileTagging } from "../fileTagging.js";

const WORKSPACE = [
  { basename: "FlowBar.tsx", path: "C:/proj/src/components/FlowBar.tsx" },
  { basename: "overlay.ts", path: "C:/proj/electron/windows/overlay.ts" },
  { basename: "authCheck.ts", path: "C:/proj/authCheck.ts" },
];

vi.mock("../../../storage/fileIndex.js", () => ({
  searchIndexByName: () => [],
}));

vi.mock("../ideContext.js", () => ({
  isCursorOrWindsurf: (p?: string | null) =>
    (p ?? "").toLowerCase() === "cursor" ||
    (p ?? "").toLowerCase().includes("windsurf"),
  getOpenFileBasename: () => "overlay.ts",
  listWorkspaceSourceFiles: () => WORKSPACE,
  findWorkspaceBasename: (spoken: string) => {
    const want = spoken.replace(/^@/, "").toLowerCase();
    return WORKSPACE.find((f) => f.basename.toLowerCase() === want)?.basename ?? null;
  },
}));

describe("applyFileTagging", () => {
  it("no-ops outside Cursor/Windsurf", () => {
    const out = applyFileTagging("check authCheck dot ts", "notepad");
    expect(out.text).toBe("check authCheck dot ts");
    expect(out.tags).toEqual([]);
  });

  it("tags spoken extension filenames from the workspace", () => {
    const out = applyFileTagging("fix the bug in authCheck dot ts", "cursor");
    expect(out.text).toContain("@authCheck.ts");
    expect(out.tags).toContain("@authCheck.ts");
  });

  it("tags with trigger word and camelCase spoken name", () => {
    const out = applyFileTagging("look at flow bar dot tsx", "cursor");
    expect(out.text).toContain("@FlowBar.tsx");
  });

  it("tags a workspace file that is not the open tab", () => {
    const out = applyFileTagging("Check flowbar.tsx and find the issue", "cursor");
    expect(out.text).toContain("@FlowBar.tsx");
    expect(out.tags).toContain("@FlowBar.tsx");
  });

  it("tags overlay.ts while another file is not required to be focused", () => {
    const out = applyFileTagging(
      "Check the overlay.ts and find the bug in that",
      "cursor",
    );
    expect(out.text).toContain("@overlay.ts");
  });

  it("does not tag a filename that is not in the workspace", () => {
    const out = applyFileTagging("Check CleanupTags.ts please", "cursor");
    expect(out.text).toBe("Check CleanupTags.ts please");
    expect(out.tags).toEqual([]);
  });
});
