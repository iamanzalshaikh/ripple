import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { clipboard } from "electron";
import { restoreFocusContext } from "../../focus/focusContext.js";
import { delay } from "../delay.js";
import { pasteFromClipboard, selectAll } from "../keyboard.js";
import type { UndoAction } from "./undoStack.js";
import { isDirectoryPath } from "./undoTrash.js";

export async function reverseUndoAction(action: UndoAction): Promise<string> {
  switch (action.kind) {
    case "rename": {
      if (!existsSync(action.to)) {
        throw new Error(`Cannot undo rename — missing ${action.to}`);
      }
      renameSync(action.to, action.from);
      return `Undid rename → ${action.from}`;
    }
    case "move": {
      if (!existsSync(action.to)) {
        throw new Error(`Cannot undo move — missing ${action.to}`);
      }
      mkdirSync(dirname(action.from), { recursive: true });
      renameSync(action.to, action.from);
      return `Undid move → ${action.from}`;
    }
    case "delete": {
      if (!action.backupPath || !existsSync(action.backupPath)) {
        throw new Error(
          "Cannot undo delete — backup missing (file was permanently removed)",
        );
      }
      if (existsSync(action.path)) {
        throw new Error(`Cannot undo delete — ${action.path} already exists`);
      }
      mkdirSync(dirname(action.path), { recursive: true });
      renameSync(action.backupPath, action.path);
      return `Restored deleted item → ${action.path}`;
    }
    case "create": {
      if (existsSync(action.path)) {
        const dir = isDirectoryPath(action.path);
        if (dir) {
          rmSync(action.path, { recursive: true, force: true });
        } else {
          unlinkSync(action.path);
        }
        return `Undid create — removed ${action.path}`;
      }
      throw new Error(`Cannot undo create — missing ${action.path}`);
    }
    case "restore_file": {
      if (!action.backupPath || !existsSync(action.backupPath)) {
        throw new Error("Cannot undo write — backup missing");
      }
      copyFileSync(action.backupPath, action.path);
      return `Restored file from backup → ${action.path}`;
    }
    case "restore_text_field": {
      const priorClipboard = clipboard.readText();
      await restoreFocusContext();
      await delay(450);
      clipboard.writeText(action.previousText);
      await delay(80);
      await selectAll();
      await delay(60);
      await pasteFromClipboard();
      clipboard.writeText(priorClipboard);
      return action.surface
        ? `Restored previous text in ${action.surface}`
        : "Restored previous text";
    }
    default:
      throw new Error("Unknown undo action");
  }
}

/** Record helper for create_file / create_folder undo payload. */
export function undoCreatePath(path: string): UndoAction {
  return { kind: "create", path };
}

export function undoRenamePaths(from: string, to: string): UndoAction {
  return { kind: "rename", from, to };
}

export function undoMovePaths(from: string, to: string): UndoAction {
  return { kind: "move", from, to };
}

export function undoDeletePaths(path: string, backupPath: string): UndoAction {
  return { kind: "delete", path, backupPath };
}
