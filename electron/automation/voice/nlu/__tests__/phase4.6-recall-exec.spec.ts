import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { parseDesktopIntent } from "../pipeline.js";
import { runRecallMemoryAction } from "../../../desktop/runSessionMemoryAction.js";
import { appendActivityLog, clearActivityLog } from "../../../../storage/activityLog.js";
import * as activityLog from "../../../../storage/activityLog.js";
import * as desktopHistory from "../../../../storage/desktopHistory.js";
import { setMemory, clearMemory } from "../../../../storage/sessionMemory.js";
import { useFreshNluCache } from "./testHelpers.js";
import { upsertFileIndexPath } from "../../../../storage/fileIndex.js";

useFreshNluCache();

const downloadsPath = join(homedir(), "Downloads");

beforeEach(() => {
  clearActivityLog();
  for (const key of [
    "last_file",
    "last_pdf",
    "last_video",
    "last_image",
    "last_folder",
    "last_project",
    "last_app",
    "last_workspace",
    "last_opened_path",
    "last_opened_kind",
    "last_parent_folder",
    "last_viewed_pdf",
    "last_viewed_pdf_title",
    "last_viewed_pdf_at",
    "last_viewed_video",
    "last_viewed_video_title",
    "last_viewed_video_at",
    "last_viewed_image",
    "last_viewed_image_title",
    "last_viewed_image_at",
  ] as const) {
    clearMemory(key);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Phase 4.6 — recall parsing (Hinglish + Hindi)", () => {
  it.each([
    "Open it again",
    "Same file again",
    "That folder again",
    "Go back",
    "Bring it back",
    "Dubara kholo",
    "Phir se open karo",
    "Woh project kholo",
    "फिर से खोलो",
  ])('parses "%s"', (cmd) => {
    expect(parseDesktopIntent(cmd)?.intent.kind).toBe("recall_memory");
  });
});

describe("Phase 4.6 — recall execution", () => {
  it("auto recalls last_opened folder after Open Downloads", async () => {
    setMemory("last_opened_path", downloadsPath);
    setMemory("last_opened_kind", "folder");
    setMemory("last_folder", downloadsPath);

    const result = await runRecallMemoryAction("auto");
    expect(result).toMatch(/Opened folder/i);
    expect(result).toContain("Downloads");
  });

  it("same file again uses last_file not stale folder", async () => {
    const resume = join(downloadsPath, "resume.pdf");
    setMemory("last_file", resume);
    setMemory("last_opened_path", resume);
    setMemory("last_opened_kind", "file");
    setMemory("last_folder", downloadsPath);

    const intent = parseDesktopIntent("Same file again");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("file");
    }
  });

  it("open last video parses to video recall target", () => {
    const intent = parseDesktopIntent("Open last video I opened");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("video");
    }
  });

  it("open last image prefers newest activity over older viewed memory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-image-act-"));
    const older = join(dir, "FirstImage.png");
    const newer = join(dir, "SecondImage.png");
    writeFileSync(older, "a");
    writeFileSync(newer, "b");

    setMemory("last_viewed_image", older);
    setMemory("last_viewed_image_at", String(Date.now()));
    appendActivityLog({
      path: newer,
      command: "viewed image (focus-title)",
      summary: "SecondImage.png — viewed",
    });

    const result = await runRecallMemoryAction("image");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("SecondImage.png");
  });

  it("open last video prefers activity log over stale last_video memory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-video-act-"));
    const recent = join(dir, "ScreenRecordingRecent.mp4");
    const stale = join(dir, "OldMarketingVideo.mp4");
    writeFileSync(recent, "video");
    writeFileSync(stale, "video");
    upsertFileIndexPath(recent);
    upsertFileIndexPath(stale);

    setMemory("last_video", stale);
    appendActivityLog({
      path: recent,
      command: "manual open",
      summary: "ScreenRecordingRecent.mp4 — manual open",
    });

    const result = await runRecallMemoryAction("video");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("ScreenRecordingRecent.mp4");
  });

  it("open last image prefers focus-viewed image over stale last_image", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ripple-image-focus-"));
    const viewed = join(dir, "ScreenshotFocus.png");
    const stale = join(dir, "web-showcase.png");
    writeFileSync(viewed, "image");
    writeFileSync(stale, "image");
    upsertFileIndexPath(viewed);
    upsertFileIndexPath(stale);

    setMemory("last_image", stale);
    setMemory("last_viewed_image", viewed);
    setMemory("last_viewed_image_at", String(Date.now()));
    setMemory("last_viewed_image_title", "ScreenshotFocus.png");
    appendActivityLog({
      path: viewed,
      command: "viewed image (focus-title)",
      summary: "ScreenshotFocus.png — viewed",
    });

    const result = await runRecallMemoryAction("image");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("ScreenshotFocus.png");
  });

  it("open last video falls back to indexed screen recordings", async () => {
    vi.spyOn(activityLog, "searchRecentOpenedPathsByKind").mockReturnValue([]);
    vi.spyOn(
      desktopHistory,
      "searchRecentDesktopHistoryPathsByKind",
    ).mockReturnValue([]);

    const dir = mkdtempSync(join(tmpdir(), "ripple-video-"));
    const video = join(dir, "ScreenRecordingTest.mp4");
    writeFileSync(video, "video");
    upsertFileIndexPath(video);

    const result = await runRecallMemoryAction("video");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("ScreenRecordingTest.mp4");
  });

  it("open last image falls back to indexed images", async () => {
    vi.spyOn(activityLog, "searchRecentOpenedPathsByKind").mockReturnValue([]);
    vi.spyOn(
      desktopHistory,
      "searchRecentDesktopHistoryPathsByKind",
    ).mockReturnValue([]);

    const dir = mkdtempSync(join(tmpdir(), "ripple-image-"));
    const image = join(dir, "ScreenshotTest.png");
    writeFileSync(image, "image");
    upsertFileIndexPath(image);

    const result = await runRecallMemoryAction("image");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("ScreenshotTest.png");
  });

  it("go back opens parent folder", async () => {
    const followers = join(downloadsPath, "Followers");
    setMemory("last_opened_path", followers);
    setMemory("last_opened_kind", "folder");
    setMemory("last_parent_folder", downloadsPath);
    setMemory("last_folder", followers);

    const intent = parseDesktopIntent("Go back");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("parent");
    }

    const result = await runRecallMemoryAction("parent");
    expect(result).toMatch(/Opened folder/i);
    expect(result).toContain("Downloads");
  });

  it.skipIf(!existsSync(join(downloadsPath, "resume.latest.pdf")))(
    "open last pdf uses last_pdf not newest indexed pdf",
    async () => {
    const olderPdf = join(downloadsPath, "resume.latest.pdf");
    const newerTxt = join(downloadsPath, "notes.txt");
    setMemory("last_pdf", olderPdf);
    setMemory("last_file", newerTxt);
    setMemory("last_opened_path", newerTxt);
    setMemory("last_opened_kind", "file");
    appendActivityLog({
      path: olderPdf,
      command: "open resume",
      summary: "resume.latest.pdf",
    });

    const intent = parseDesktopIntent("Open last pdf");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("pdf");
    }

    const result = await runRecallMemoryAction("pdf");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("resume.latest.pdf");
  },
  );

  it.skipIf(!existsSync(join(downloadsPath, "notes.txt")))(
    "open last file recalls last generic file from activity",
    async () => {
    const notes = join(downloadsPath, "notes.txt");
    setMemory("last_file", notes);
    setMemory("last_opened_path", downloadsPath);
    setMemory("last_opened_kind", "folder");
    setMemory("last_folder", downloadsPath);
    appendActivityLog({
      path: notes,
      command: "open notes",
      summary: "notes.txt",
    });

    const intent = parseDesktopIntent("Open last file");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("file");
    }

    const result = await runRecallMemoryAction("file");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("notes.txt");
  },
  );
});
