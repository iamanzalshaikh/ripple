import { beforeEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { parseDesktopIntent } from "../pipeline.js";
import { desktopBatchPayload } from "../../../desktop/desktopCommand.js";
import { runDesktopOpenBatch } from "../../../desktop/runDesktopAction.js";
import { appendActivityLog, clearActivityLog } from "../../../../storage/activityLog.js";
import { clearMemory } from "../../../../storage/sessionMemory.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

beforeEach(() => {
  clearActivityLog();
  for (const key of [
    "last_pdf",
    "last_image",
    "last_video",
    "last_folder",
    "last_file",
    "last_opened_path",
    "last_opened_kind",
  ] as const) {
    clearMemory(key);
  }
});

describe("compound recall execution (P8)", () => {
  it("executes open last pdf + open last folder sequentially", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-compound-"));
    const pdf = join(dir, "compound-test.pdf");
    const folder = join(dir, "ProjectFolder");
    mkdirSync(folder);
    writeFileSync(pdf, "pdf");

    appendActivityLog({
      path: pdf,
      command: "viewed pdf",
      summary: "compound-test.pdf",
    });
    appendActivityLog({
      path: folder,
      command: "viewed folder",
      summary: "ProjectFolder",
    });

    const cmd = "Open last pdf I opened. Open last folder I opened";
    const parsed = parseDesktopIntent(cmd);
    expect(parsed?.intent.kind).toBe("compound");
    if (parsed?.intent.kind !== "compound") return;

    expect(parsed.intent.steps).toHaveLength(2);
    expect(parsed.intent.steps[0]?.kind).toBe("recall_memory");
    expect(parsed.intent.steps[1]?.kind).toBe("recall_memory");

    const results: string[] = [];
    for (let i = 0; i < parsed.intent.steps.length; i++) {
      const step = parsed.intent.steps[i]!;
      const batch = desktopBatchPayload(
        step,
        `${cmd.trim()} [${i + 1}/${parsed.intent.steps.length}]`,
      );
      results.push(await runDesktopOpenBatch(batch));
    }

    const combined = results.join(" → ");
    expect(combined).toMatch(/Opened file/i);
    expect(combined).toMatch(/Opened folder/i);
    expect(combined).toContain("compound-test.pdf");
    expect(combined).toContain("ProjectFolder");
  });

  it("compound with aur splits recall steps", () => {
    const parsed = parseDesktopIntent(
      "Open last pdf I opened aur open last folder I opened",
    );
    expect(parsed?.intent.kind).toBe("compound");
    if (parsed?.intent.kind === "compound") {
      expect(parsed.intent.steps.length).toBeGreaterThanOrEqual(2);
    }
  });
});
