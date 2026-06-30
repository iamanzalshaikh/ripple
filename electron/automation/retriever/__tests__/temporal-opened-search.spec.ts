import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRippleDb, getRippleDb } from "../../../storage/rippleDb.js";
import { clearActivityLog } from "../../../storage/activityLog.js";
import { retrieveFileCandidates } from "../retriever.js";
import { timeRangeToWindow } from "../timeRange.js";

describe("temporal opened file search (P8)", () => {
  let workDir: string;

  beforeEach(() => {
    initRippleDb();
    clearActivityLog();
    getRippleDb().exec(`DELETE FROM desktop_history`);
    workDir = mkdtempSync(join(tmpdir(), "ripple-temporal-"));
  });

  it("finds pdf opened yesterday via activity_log", async () => {
    const path = join(workDir, "yesterday-report.pdf");
    writeFileSync(path, "report");

    const { startMs } = timeRangeToWindow("yesterday");
    const openedAt = new Date(startMs + 60 * 60 * 1000).toISOString();

    getRippleDb()
      .prepare(
        `INSERT INTO activity_log (path, app_id, contact, command, summary, created_at)
         VALUES (?, NULL, NULL, ?, ?, ?)`,
      )
      .run(path, "Open yesterday-report.pdf", "yesterday-report.pdf", openedAt);

    const hits = await retrieveFileCandidates({
      phrase: "Open yesterday pdf I opened",
      extension: "pdf",
      timeRange: "yesterday",
    });

    expect(hits.some((h) => h.path === path)).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  it("finds pdf opened yesterday via desktop_history fallback", async () => {
    const path = join(workDir, "history-yesterday.pdf");
    writeFileSync(path, "history");

    const { startMs } = timeRangeToWindow("yesterday");
    const openedAt = new Date(startMs + 2 * 60 * 60 * 1000).toISOString();

    getRippleDb()
      .prepare(
        `INSERT INTO desktop_history
         (command, intent, resolved_path, entities_json, result, status, created_at)
         VALUES (?, ?, ?, NULL, ?, 'ok', ?)`,
      )
      .run(
        "Open yesterday pdf I opened",
        "workflow",
        path,
        `Opened file: ${path}`,
        openedAt,
      );

    const hits = await retrieveFileCandidates({
      phrase: "Open yesterday pdf I opened",
      extension: "pdf",
      timeRange: "yesterday",
    });

    expect(hits.some((h) => h.path === path)).toBe(true);
  });

  it("finds image opened yesterday via activity_log (image alias)", async () => {
    const path = join(workDir, "screenshot-yesterday.png");
    writeFileSync(path, "img");

    const { startMs } = timeRangeToWindow("yesterday");
    const openedAt = new Date(startMs + 60 * 60 * 1000).toISOString();

    getRippleDb()
      .prepare(
        `INSERT INTO activity_log (path, app_id, contact, command, summary, created_at)
         VALUES (?, NULL, NULL, ?, ?, ?)`,
      )
      .run(path, "viewed image", "screenshot-yesterday.png", openedAt);

    const hits = await retrieveFileCandidates({
      phrase: "Open image I opened yesterday",
      extension: "image",
      timeRange: "yesterday",
    });

    expect(hits.some((h) => h.path === path)).toBe(true);
  });
});
