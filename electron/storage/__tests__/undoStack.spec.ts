import { describe, expect, it, beforeAll } from "vitest";
import { initRippleDb } from "../rippleDb.js";
import {
  popUndoAction,
  pushUndoAction,
  undoStackSize,
} from "../../automation/safety/undoStack.js";

describe("undoStack persistence", () => {
  beforeAll(() => {
    initRippleDb();
  });

  it("persists and pops undo actions", () => {
    while (popUndoAction()) {
      /* drain */
    }
    pushUndoAction({
      kind: "rename",
      from: "C:\\test\\old.txt",
      to: "C:\\test\\new.txt",
    });
    expect(undoStackSize()).toBe(1);
    const action = popUndoAction();
    expect(action?.kind).toBe("rename");
    expect(undoStackSize()).toBe(0);
  });
});
