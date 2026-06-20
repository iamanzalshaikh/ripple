import { describe, expect, it } from "vitest";
import {
  filterCandidatesByTimeRange,
  parseTimeRangeFromText,
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
    expect(parseTimeRangeFromText("this morning invoice")).toBe("this_morning");
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
