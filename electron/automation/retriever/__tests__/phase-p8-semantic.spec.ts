import { describe, expect, it, beforeEach } from "vitest";
import { initRippleDb } from "../../../storage/rippleDb.js";
import {
  appendActivityLog,
  clearActivityLog,
  searchActivityByPhrase,
} from "../../../storage/activityLog.js";
import {
  clearSemanticIndex,
  upsertSemanticIndex,
  searchSemanticIndex,
} from "../../../storage/semanticIndex.js";
import { isSemanticQuery } from "../parseSemanticQuery.js";
import { semanticRankCandidates } from "../semanticRetriever.js";
import { tokenizeForSemantic, semanticOverlapScore } from "../semanticScoring.js";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("P8 semantic memory", () => {
  let workDir: string;

  beforeEach(() => {
    initRippleDb();
    clearActivityLog();
    clearSemanticIndex();
    workDir = mkdtempSync(join(tmpdir(), "ripple-p8-"));
  });

  it("detects vague semantic queries", () => {
    expect(isSemanticQuery("PDF I discussed with Ahmed")).toBe(true);
    expect(isSemanticQuery("open downloads")).toBe(false);
  });

  it("tokenizes and scores overlap", () => {
    const tokens = tokenizeForSemantic("quarterly invoice ahmed project");
    const score = semanticOverlapScore(
      "invoice discussed with ahmed",
      tokens,
      "quarterly invoice ahmed",
    );
    expect(score).toBeGreaterThan(0.3);
  });

  it("activity log links contact to path", () => {
    const path = join(workDir, "ahmed-proposal.pdf");
    writeFileSync(path, "proposal for ahmed");

    appendActivityLog({
      path,
      contact: "ahmed",
      command: "Send proposal to Ahmed",
      summary: "ahmed-proposal.pdf",
    });

    const hits = searchActivityByPhrase("discussed with ahmed");
    expect(hits).toContain(path);
  });

  it("semantic index finds topic match", () => {
    const path = join(workDir, "goa-trip-itinerary.pdf");
    writeFileSync(path, "Goa trip hotel booking flights");

    upsertSemanticIndex({
      path,
      command: "open goa trip itinerary",
    });

    const profiles = searchSemanticIndex("before my goa trip");
    expect(profiles.some((p) => p.path === path)).toBe(true);
  });

  it("semanticRankCandidates boosts activity-linked file", () => {
    const path = join(workDir, "sarah-contract.pdf");
    writeFileSync(path, "contract draft for sarah");

    appendActivityLog({
      path,
      contact: "sarah",
      command: "document from Sarah meeting",
      summary: "sarah-contract.pdf",
    });
    upsertSemanticIndex({ path, command: "Sarah contract meeting", contact: "sarah" });

    const ranked = semanticRankCandidates(
      "PDF I discussed with Sarah",
      [
        {
          path: join(workDir, "other.pdf"),
          label: "other.pdf",
          score: 0.8,
          source: "index",
        },
        {
          path,
          label: "sarah-contract.pdf",
          score: 0.5,
          source: "index",
        },
      ].filter((c) => {
        writeFileSync(c.path, "x");
        return existsSync(c.path);
      }),
    );

    expect(ranked[0]?.path).toBe(path);
    expect(ranked[0]?.source).toBe("semantic");
  });
});
