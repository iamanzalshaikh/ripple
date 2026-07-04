import { describe, expect, it } from "vitest";
import {
  isEditableControlType,
  stepNeedsInputReadyGate,
} from "../planner/executionSync.js";
import {
  isSaveDialogContext,
  isSaveDialogTitle,
} from "../../focus/saveDialogMode.js";
import { parseWorkflowMetaCommand } from "../../automation/desktop/parseWorkflowCommand.js";
import { parseWorkflowStepList } from "../../automation/desktop/userWorkflows.js";

describe("P8.5 execution sync", () => {
  it("detects Win32 Save As dialog titles", () => {
    expect(isSaveDialogTitle("Save As")).toBe(true);
    expect(isSaveDialogTitle("Save as")).toBe(true);
    expect(isSaveDialogContext({ windowTitle: "Save as" })).toBe(true);
    expect(isSaveDialogTitle("Untitled - Notepad")).toBe(false);
    expect(isSaveDialogTitle("*hello - Notepad")).toBe(false);
    expect(isSaveDialogTitle("Notepad")).toBe(false);
  });
  it("recognizes editable UIA control types", () => {
    expect(isEditableControlType("Edit")).toBe(true);
    expect(isEditableControlType("Document")).toBe(true);
    expect(isEditableControlType("Text")).toBe(true);
    expect(isEditableControlType("Pane")).toBe(false);
  });

  it("flags input-ready tools for preflight", () => {
    expect(stepNeedsInputReadyGate("desktop.type_text")).toBe(true);
    expect(stepNeedsInputReadyGate("desktop.save_file")).toBe(true);
    expect(stepNeedsInputReadyGate("desktop.launch_app")).toBe(false);
  });

  it("work mode workflow stores multi-action steps schema", () => {
    const intent = parseWorkflowMetaCommand(
      "Remember work mode open YouTube, Paint and Calculator",
    );
    expect(intent?.kind).toBe("remember_workflow");
    if (intent?.kind !== "remember_workflow") return;
    const steps = parseWorkflowStepList(intent.stepsRaw);
    expect(steps).toEqual([
      { type: "workspace", target: "youtube" },
      { type: "app", target: "paint" },
      { type: "app", target: "calculator" },
    ]);
  });
});
