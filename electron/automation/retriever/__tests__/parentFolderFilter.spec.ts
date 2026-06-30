import { describe, expect, it, vi } from "vitest";
import { filterCandidatesByParentFolder } from "../parentFolderFilter.js";
import type { Candidate } from "../../planner/types.js";

vi.mock("../../desktop/openFolder.js", () => ({
  resolveFolderPath: (key: string) => {
    if (key === "downloads") return "C:\\Users\\me\\Downloads";
    if (key === "documents") return "C:\\Users\\me\\Documents";
    return "C:\\Users\\me\\Desktop";
  },
}));

function candidate(path: string): Candidate {
  return {
    path,
    label: path.split("\\").pop() ?? path,
    score: 0.9,
    source: "windows_search",
  };
}

describe("parentFolderFilter P5", () => {
  it("narrows hits to downloads when parent hint is downloads", () => {
    const all = [
      candidate("C:\\Users\\me\\Downloads\\resume.pdf"),
      candidate("C:\\Users\\me\\Documents\\resume.pdf"),
    ];
    const filtered = filterCandidatesByParentFolder(all, "downloads");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.path).toContain("Downloads");
  });

  it("keeps all hits when parent filter would remove everything", () => {
    const all = [candidate("C:\\Users\\me\\Documents\\only.pdf")];
    const filtered = filterCandidatesByParentFolder(all, "downloads");
    expect(filtered).toEqual(all);
  });
});
