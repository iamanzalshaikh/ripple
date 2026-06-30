import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRippleDb } from "../../../storage/rippleDb.js";
import {
  clearUndoStack,
  popUndoAction,
  pushUndoAction,
  rollbackUndoTo,
  undoStackSize,
} from "../undoStack.js";
import {
  reverseUndoAction,
  undoCreatePath,
  undoDeletePaths,
  undoMovePaths,
  undoRenamePaths,
} from "../undoRunner.js";
import { stageDeleteBackup } from "../undoTrash.js";

describe("P4.7 undoRunner", () => {
  let workDir: string;

  beforeAll(() => {
    initRippleDb();
  });

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "ripple-p47-"));
    clearUndoStack();
  });

  it("restores original name after rename undo", async () => {
    const from = join(workDir, "report.txt");
    const to = join(workDir, "report-v2.txt");
    writeFileSync(from, "quarterly");
    renameSync(from, to);

    const msg = await reverseUndoAction(undoRenamePaths(from, to));
    expect(msg).toContain("Undid rename");
    expect(existsSync(from)).toBe(true);
    expect(existsSync(to)).toBe(false);
    expect(readFileSync(from, "utf8")).toBe("quarterly");
  });

  it("restores deleted file from trash backup", async () => {
    const path = join(workDir, "keep-me.txt");
    writeFileSync(path, "important");

    const backupPath = stageDeleteBackup(path);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(backupPath)).toBe(true);

    const msg = await reverseUndoAction(undoDeletePaths(path, backupPath));
    expect(msg).toContain("Restored");
    expect(readFileSync(path, "utf8")).toBe("important");
  });

  it("removes created file on create undo", async () => {
    const path = join(workDir, "temp-file.txt");
    writeFileSync(path, "draft");

    await reverseUndoAction(undoCreatePath(path));
    expect(existsSync(path)).toBe(false);
  });

  it("rollbackUndoTo reverses workflow steps in LIFO order", async () => {
    const a = join(workDir, "a.txt");
    const b = join(workDir, "b.txt");
    writeFileSync(a, "a");
    writeFileSync(b, "b");

    const sizeBefore = undoStackSize();
    pushUndoAction(undoCreatePath(a));
    pushUndoAction(undoCreatePath(b));
    expect(undoStackSize()).toBe(sizeBefore + 2);

    const rolled = await rollbackUndoTo(sizeBefore, reverseUndoAction);

    expect(rolled).toHaveLength(2);
    expect(undoStackSize()).toBe(sizeBefore);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(false);
  });

  it("restores moved file to original folder", async () => {
    const fromDir = join(workDir, "src");
    const toDir = join(workDir, "dest");
    mkdirSync(fromDir, { recursive: true });
    mkdirSync(toDir, { recursive: true });
    const from = join(fromDir, "notes.txt");
    const to = join(toDir, "notes.txt");
    writeFileSync(from, "draft");
    renameSync(from, to);

    const msg = await reverseUndoAction(undoMovePaths(from, to));
    expect(msg).toContain("Undid move");
    expect(existsSync(from)).toBe(true);
    expect(existsSync(to)).toBe(false);
  });

  it("popUndoAction returns most recent entry", () => {
    pushUndoAction(undoCreatePath(join(workDir, "one.txt")));
    pushUndoAction(undoCreatePath(join(workDir, "two.txt")));
    const action = popUndoAction();
    expect(action?.path).toContain("two.txt");
  });
});
