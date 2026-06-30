import { describe, expect, it } from "vitest";
import {
  filterCandidatesByTimeRange,
  parseParentFolderFromText,
  parseTimeRangeFromText,
  stripTimePhrasesFromToken,
  timeRangeToWindow,
} from "../timeRange.js";
import type { Candidate } from "../../planner/types.js";

describe("timeRange", () => {
  it("parses common spoken ranges", () => {
    expect(parseTimeRangeFromText("open pdf from yesterday")).toBe("yesterday");
    expect(parseTimeRangeFromText("file from last week")).toBe("last_week");
    expect(parseTimeRangeFromText("pdf I edited 3 months ago")).toBe(
      "3_months_ago",
    );
    expect(parseTimeRangeFromText("pdf which I opened two months ago")).toBe(
      "months_2_ago",
    );
    expect(parseTimeRangeFromText("this morning invoice")).toBe("this_morning");
    expect(parseTimeRangeFromText("kal wali pdf kholo")).toBe("yesterday");
    expect(parseTimeRangeFromText("aaj ki pdf")).toBe("today");
    expect(parseTimeRangeFromText("teen mahine pehle pdf")).toBe("3_months_ago");
  });

  it("strips time phrases from filename token", () => {
    expect(stripTimePhrasesFromToken("pdf I edited 3 months ago")).toBe("");
    expect(stripTimePhrasesFromToken("resume from yesterday")).toBe("resume");
    expect(stripTimePhrasesFromToken("pdf which I opened two months ago")).toBe(
      "",
    );
  });

  it("parses downloads parent folder hint", () => {
    expect(parseParentFolderFromText("pdf in downloads from yesterday")).toBe(
      "downloads",
    );
  });

  it("filters candidates by mtime window", () => {
    const now = Date.now();
    const candidates: Candidate[] = [
      {
        path: "C:\\a.pdf",
        label: "a.pdf",
        score: 0.9,
        source: "index",
        mtime: now - 2 * 24 * 60 * 60 * 1000,
      },
      {
        path: "C:\\b.pdf",
        label: "b.pdf",
        score: 0.8,
        source: "index",
        mtime: now - 40 * 24 * 60 * 60 * 1000,
      },
    ];
    const filtered = filterCandidatesByTimeRange(candidates, "last_week");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.path).toContain("a.pdf");
  });

  it("builds valid windows", () => {
    const w = timeRangeToWindow("yesterday");
    expect(w.endMs).toBeGreaterThan(w.startMs);
  });
});
