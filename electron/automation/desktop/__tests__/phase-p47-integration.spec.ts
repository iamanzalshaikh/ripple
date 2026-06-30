import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initRippleDb } from "../../../storage/rippleDb.js";
import { clearUndoStack } from "../../safety/undoStack.js";
import { setConfirmHandlerForTests } from "../../safety/executionGuard.js";
import { runDesktopOpenBatch } from "../runDesktopAction.js";
import { buildDesktopCommandResult } from "../desktopCommand.js";

describe("P4.7 — undo integration", () => {
  let sandbox: string;

  beforeEach(() => {
    initRippleDb();
    clearUndoStack();
    sandbox = join(tmpdir(), `ripple-p47-int-${Date.now()}`);
    mkdirSync(sandbox, { recursive: true });
    vi.stubEnv("USERPROFILE", sandbox);
    mkdirSync(join(sandbox, "Downloads"), { recursive: true });
    setConfirmHandlerForTests(async () => true);
  });

  afterEach(() => {
    setConfirmHandlerForTests(null);
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.unstubAllEnvs();
    clearUndoStack();
  });

  it("buildDesktopCommandResult routes undo voice to workflow", () => {
    const payload = buildDesktopCommandResult("undo last action");
    expect(payload?.intent).toBe("workflow");
    const step = payload?.actions?.[0]?.data?.steps?.[0]?.data as
      | Record<string, unknown>
      | undefined;
    expect(step?.desktopKind).toBe("undo_last");
  });

  it("rename then undo restores original filename", async () => {
    const downloads = join(sandbox, "Downloads");
    const from = join(downloads, "report.txt");
    writeFileSync(from, "quarterly");

    await runDesktopOpenBatch({
      _desktopBatch: true,
      desktopKind: "rename_file",
      sourceName: "report.txt",
      newName: "report-v2.txt",
      parentFolder: "downloads",
      command: "rename report.txt to report-v2.txt in downloads",
      _safetyConfirmed: true,
    });

    const renamed = join(downloads, "report-v2.txt");
    expect(existsSync(renamed)).toBe(true);
    expect(existsSync(from)).toBe(false);

    const undoMsg = await runDesktopOpenBatch({
      _desktopBatch: true,
      desktopKind: "undo_last",
      command: "undo",
    });

    expect(undoMsg).toMatch(/Undid rename/i);
    expect(existsSync(from)).toBe(true);
    expect(readFileSync(from, "utf8")).toBe("quarterly");
    expect(existsSync(renamed)).toBe(false);
  });

  it("create folder then undo removes it", async () => {
    const downloads = join(sandbox, "Downloads");
    const folderPath = join(downloads, "ripple-test");

    await runDesktopOpenBatch({
      _desktopBatch: true,
      desktopKind: "create_folder",
      folderName: "ripple-test",
      parentFolder: "downloads",
      command: "create folder ripple-test in downloads",
    });

    expect(existsSync(folderPath)).toBe(true);

    await runDesktopOpenBatch({
      _desktopBatch: true,
      desktopKind: "undo_last",
      command: "wapas karo",
    });

    expect(existsSync(folderPath)).toBe(false);
  });

  it("undo with empty stack throws guided error", async () => {
    await expect(
      runDesktopOpenBatch({
        _desktopBatch: true,
        desktopKind: "undo_last",
        command: "undo",
      }),
    ).rejects.toThrow(/nothing to undo/i);
  });
});
