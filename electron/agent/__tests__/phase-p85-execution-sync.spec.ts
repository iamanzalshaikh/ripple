import { describe, expect, it } from "vitest";
import {
  isEditableControlType,
  stepNeedsInputReadyGate,
} from "../planner/executionSync.js";
import {
  isConfirmSaveAsTitle,
  isSaveDialogContext,
  isSaveDialogTitle,
  isUntitledEditorTitle,
  matchesMainDocumentA11y,
  matchesSaveFilenameA11y,
  shouldUseSilentSave,
  splitSavePath,
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
    expect(isSaveDialogTitle("Confirm Save As")).toBe(false);
    expect(isConfirmSaveAsTitle("Confirm Save As")).toBe(true);
    expect(isConfirmSaveAsTitle("Save as")).toBe(false);
  });

  it("detects untitled editor windows", () => {
    expect(isUntitledEditorTitle("Untitled - Notepad")).toBe(true);
    expect(isUntitledEditorTitle("*Untitled - Notepad")).toBe(true);
    expect(isUntitledEditorTitle("user.txt - Notepad")).toBe(false);
    expect(isUntitledEditorTitle("report.docx - Word")).toBe(false);
  });

  it("matches Win11/classic save filename UIA fields", () => {
    expect(
      matchesSaveFilenameA11y({
        name: "File name:",
        controlType: "ComboBox",
        automationId: "",
        className: "",
      }),
    ).toBe(true);
    expect(
      matchesSaveFilenameA11y({
        name: "Text editor",
        controlType: "Document",
        automationId: "",
        className: "",
      }),
    ).toBe(false);
  });

  it("detects main document vs save field for paste safety", () => {
    expect(
      matchesMainDocumentA11y({
        name: "Text editor",
        controlType: "Document",
        automationId: "",
        className: "",
      }),
    ).toBe(true);
    expect(
      matchesMainDocumentA11y({
        name: "File name:",
        controlType: "ComboBox",
        automationId: "",
        className: "",
      }),
    ).toBe(false);
  });

  it("silent save only when open file matches target basename", () => {
    expect(shouldUseSilentSave("user.txt - Notepad", "C:\\Users\\x\\Downloads\\user.txt")).toBe(true);
    expect(shouldUseSilentSave("notes.txt - Notepad", "C:\\Users\\x\\Downloads\\user.txt")).toBe(false);
    expect(shouldUseSilentSave("Untitled - Notepad", "C:\\Users\\x\\Downloads\\user.txt")).toBe(false);
  });

  it("splits save path into folder + filename", () => {
    const parts = splitSavePath("C:\\Users\\x\\Downloads\\user.txt");
    expect(parts.filename).toBe("user.txt");
    expect(parts.dir).toBe("C:\\Users\\x\\Downloads");
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
