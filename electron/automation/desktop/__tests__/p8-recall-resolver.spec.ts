import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendActivityLog,
  clearActivityLog,
} from "../../../storage/activityLog.js";
import { clearMemory } from "../../../storage/sessionMemory.js";
import { resolveLastOpenedByKind } from "../p8RecallResolver.js";
import { classifyOpenedPath } from "../openedPathKind.js";

beforeEach(() => {
  clearActivityLog();
  for (const key of [
    "last_file",
    "last_pdf",
    "last_image",
    "last_video",
    "last_folder",
    "last_project",
  ] as const) {
    clearMemory(key);
  }
});

describe("P8 recall resolver", () => {
  it("classifies paths by kind", () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-p8-kind-"));
    const pdf = join(dir, "doc.pdf");
    const img = join(dir, "pic.png");
    writeFileSync(pdf, "pdf");
    writeFileSync(img, "img");
    expect(classifyOpenedPath(dir)).toBe("folder");
    expect(classifyOpenedPath(pdf)).toBe("pdf");
    expect(classifyOpenedPath(img)).toBe("image");
  });

  it("recalls newest pdf from activity log months later (session stale)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-p8-pdf-"));
    const older = join(dir, "old.pdf");
    const newer = join(dir, "new.pdf");
    writeFileSync(older, "a");
    writeFileSync(newer, "b");

    appendActivityLog({
      path: older,
      command: "viewed pdf",
      summary: "old.pdf",
    });
    appendActivityLog({
      path: newer,
      command: "viewed pdf",
      summary: "new.pdf",
    });

    const result = await resolveLastOpenedByKind("pdf", null);
    expect(result).toBe(newer);
  });

  it("recalls newest folder from activity after browsing explorer", async () => {
    const root = mkdtempSync(join(tmpdir(), "ripple-p8-folder-"));
    const sub = join(root, "ProjectA");
    mkdirSync(sub);

    appendActivityLog({
      path: sub,
      command: "viewed folder (explorer-focus)",
      summary: "ProjectA",
    });

    const result = await resolveLastOpenedByKind("folder", null);
    expect(result).toBe(sub);
  });

  it("generic file recall skips pdf image video", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-p8-file-"));
    const pdf = join(dir, "x.pdf");
    const txt = join(dir, "notes.txt");
    writeFileSync(pdf, "p");
    writeFileSync(txt, "t");

    appendActivityLog({ path: pdf, command: "open", summary: "x.pdf" });
    appendActivityLog({ path: txt, command: "open", summary: "notes.txt" });

    const result = await resolveLastOpenedByKind("file", null);
    expect(result).toBe(txt);
  });
});
