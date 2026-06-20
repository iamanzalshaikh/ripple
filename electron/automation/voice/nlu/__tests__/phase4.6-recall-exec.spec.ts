import { describe, expect, it, beforeEach } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseDesktopIntent } from "../pipeline.js";
import { runRecallMemoryAction } from "../../../desktop/runSessionMemoryAction.js";
import { setMemory, clearMemory } from "../../../../storage/sessionMemory.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

const downloadsPath = join(homedir(), "Downloads");

beforeEach(() => {
  for (const key of [
    "last_file",
    "last_pdf",
    "last_folder",
    "last_project",
    "last_app",
    "last_workspace",
    "last_opened_path",
    "last_opened_kind",
    "last_parent_folder",
  ] as const) {
    clearMemory(key);
  }
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

  it.skipIf(!existsSync(join(downloadsPath, "resume.latest.pdf")))(
    "open last file recalls last_file without again",
    async () => {
    const resume = join(downloadsPath, "resume.latest.pdf");
    setMemory("last_file", resume);
    setMemory("last_opened_path", downloadsPath);
    setMemory("last_opened_kind", "folder");
    setMemory("last_folder", downloadsPath);

    const intent = parseDesktopIntent("Open last file");
    expect(intent?.intent.kind).toBe("recall_memory");
    if (intent?.intent.kind === "recall_memory") {
      expect(intent.intent.target).toBe("file");
    }

    const result = await runRecallMemoryAction("file");
    expect(result).toMatch(/Opened file/i);
    expect(result).toContain("resume.latest.pdf");
  },
  );
});
