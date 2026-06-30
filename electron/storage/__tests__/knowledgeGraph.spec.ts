import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRippleDb, getRippleDb } from "../rippleDb.js";
import {
  boostAppFromLaunch,
  boostEntityFromOpen,
  clearKnowledgeGraph,
  lookupAppRole,
  lookupEntity,
  rankEntities,
  rememberEntity,
} from "../knowledgeGraph.js";
import { compositeScore } from "../graphScoring.js";

describe("knowledgeGraph P5.5 decay", () => {
  let workDir: string;

  beforeEach(() => {
    initRippleDb();
    clearKnowledgeGraph();
    workDir = mkdtempSync(join(tmpdir(), "ripple-kg-"));
  });

  it("ranks fresher entity above stale high-count rival", () => {
    const oldPath = join(workDir, "old-resume.pdf");
    const newPath = join(workDir, "new-resume.pdf");
    writeFileSync(oldPath, "old");
    writeFileSync(newPath, "new");

    const staleMs = Date.now() - 200 * 24 * 60 * 60 * 1000;
    rememberEntity({
      key: "my resume old",
      path: oldPath,
      type: "file",
      composite_score: compositeScore({
        openCount: 50,
        lastOpenedAtMs: staleMs,
      }),
      open_count: 50,
    });
    getRippleDb()
      .prepare(
        `UPDATE knowledge_entity SET last_opened_at = ? WHERE canonical_key = ?`,
      )
      .run(new Date(staleMs).toISOString(), "my resume old");

    rememberEntity({
      key: "my resume new",
      path: newPath,
      type: "file",
      composite_score: compositeScore({
        openCount: 2,
        lastOpenedAtMs: Date.now(),
      }),
      open_count: 2,
    });

    const ranked = rankEntities("resume");
    expect(ranked[0]?.path).toBe(newPath);
  });

  it("learns app role from repeated launches", () => {
    boostAppFromLaunch("figma", "my design app");
    boostAppFromLaunch("figma", "my design app");
    boostAppFromLaunch("figma", "my design app");

    const role = lookupAppRole("my design app");
    expect(role?.path).toBe("figma");
    expect(role?.type).toBe("app_role");
  });

  it("tags project folders when key is my project", () => {
    const projectPath = join(workDir, "Ripple");
    mkdirSync(projectPath);
    boostEntityFromOpen("my project", projectPath);

    expect(lookupEntity("my project")?.type).toBe("project");
    expect(lookupEntity("project")?.type).toBe("project");
    expect(lookupEntity("project")?.path).toBe(projectPath);
  });
});
