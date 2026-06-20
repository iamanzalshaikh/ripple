import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createFileNeedsConfirm,
  moveNeedsConfirm,
  renameNeedsConfirm,
  simulateDeleteFile,
  simulateCreateFile,
} from "../executionSimulator.js";
import {
  confirmIfNeeded,
  riskForTool,
  setConfirmHandlerForTests,
} from "../executionGuard.js";

describe("P4.5 — risk levels", () => {
  it("delete is high risk", () => {
    expect(riskForTool("delete_file")).toBe("high");
  });

  it("move is medium risk", () => {
    expect(riskForTool("move_file")).toBe("medium");
  });
});

describe("P4.5 — conditional confirm rules", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = join(tmpdir(), `ripple-safety-${Date.now()}`);
    mkdirSync(sandbox, { recursive: true });
    vi.stubEnv("USERPROFILE", sandbox);
    mkdirSync(join(sandbox, "Downloads"), { recursive: true });
    mkdirSync(join(sandbox, "Desktop"), { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(sandbox, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.unstubAllEnvs();
  });

  it("create needs confirm when file exists", async () => {
    const path = join(sandbox, "Downloads", "notes.txt");
    writeFileSync(path, "x");
    const needs = await createFileNeedsConfirm("notes.txt", "downloads");
    expect(needs).toBe(true);
    const sim = await simulateCreateFile("notes.txt", "downloads");
    expect(sim.summary).toContain("overwrite");
  });

  it("create skips confirm when file does not exist", async () => {
    const needs = await createFileNeedsConfirm("brand-new.txt", "downloads");
    expect(needs).toBe(false);
  });

  it("move within same folder skips confirm", async () => {
    const path = join(sandbox, "Downloads", "a.txt");
    writeFileSync(path, "a");
    const needs = await moveNeedsConfirm("a.txt", "downloads", "downloads");
    expect(needs).toBe(false);
  });

  it("move across folders needs confirm", async () => {
    const path = join(sandbox, "Downloads", "b.txt");
    writeFileSync(path, "b");
    const needs = await moveNeedsConfirm("b.txt", "desktop", "downloads");
    expect(needs).toBe(true);
  });

  it("rename needs confirm when target exists", async () => {
    const dir = join(sandbox, "Downloads");
    writeFileSync(join(dir, "old.txt"), "1");
    writeFileSync(join(dir, "new.txt"), "2");
    const needs = await renameNeedsConfirm("old.txt", "new.txt", "downloads");
    expect(needs).toBe(true);
  });
});

describe("P4.5 — confirmIfNeeded blocks without approval", () => {
  afterEach(() => {
    setConfirmHandlerForTests(null);
  });

  it("throws Cancelled when user declines delete", async () => {
    setConfirmHandlerForTests(async () => false);

    await expect(
      confirmIfNeeded(
        "delete_file",
        { sourceName: "temp.txt", parentFolder: "downloads" },
        { command: "delete temp.txt" },
      ),
    ).rejects.toThrow(/Cancelled/i);
  });

  it("sets _safetyConfirmed when user approves", async () => {
    setConfirmHandlerForTests(async () => true);
    const data: Record<string, unknown> = { command: "delete temp.txt" };

    await confirmIfNeeded(
      "delete_file",
      { sourceName: "temp.txt", parentFolder: "downloads" },
      data,
    );

    expect(data._safetyConfirmed).toBe(true);
  });

  it("skips dialog when already confirmed", async () => {
    const handler = vi.fn(async () => true);
    setConfirmHandlerForTests(handler);

    await confirmIfNeeded(
      "delete_file",
      { sourceName: "temp.txt" },
      { _safetyConfirmed: true },
    );

    expect(handler).not.toHaveBeenCalled();
  });

  it("delete simulation lists target path when found", async () => {
    const sim = await simulateDeleteFile("missing-file-xyz.txt", "downloads");
    expect(sim.summary).toContain("Would delete");
  });
});
