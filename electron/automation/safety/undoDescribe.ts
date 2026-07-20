import { basename } from "node:path";
import type { UndoAction } from "./undoStack.js";

/** Human-readable label for the last undoable action (P4.7). */
export function describeUndoAction(action: UndoAction): string {
  switch (action.kind) {
    case "rename":
      return `rename ${basename(action.from)} → ${basename(action.to)}`;
    case "move":
      return `move ${basename(action.from)}`;
    case "delete":
      return `delete ${basename(action.path)}`;
    case "create":
      return `create ${basename(action.path)}`;
    case "restore_text_field":
      return action.surface ? `text edit in ${action.surface}` : "text edit";
    default:
      return "last action";
  }
}
