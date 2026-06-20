import { describe, expect, it, beforeEach } from "vitest";
import { initRippleDb } from "../rippleDb.js";
import {
  getWorkflowGraph,
  resetWorkflowGraphForTests,
  saveWorkflowGraph,
} from "../workflowGraph.js";
import type { WorkflowStepDef } from "../../automation/desktop/userWorkflows.js";

const STEPS_A: WorkflowStepDef[] = [
  { type: "app", target: "vscode" },
  { type: "app", target: "chrome" },
];

const STEPS_B: WorkflowStepDef[] = [
  { type: "app", target: "vscode" },
  { type: "app", target: "slack" },
];

describe("workflowGraph P5.5", () => {
  beforeEach(() => {
    initRippleDb();
    resetWorkflowGraphForTests();
  });

  it("creates workflow at version 1", () => {
    const entry = saveWorkflowGraph("work mode", STEPS_A);
    expect(entry.version).toBe(1);
    expect(entry.steps).toEqual(STEPS_A);
  });

  it("rejects duplicate name without replace", () => {
    saveWorkflowGraph("work mode", STEPS_A);
    expect(() => saveWorkflowGraph("work mode", STEPS_B)).toThrow(
      /already exists/,
    );
  });

  it("bumps version on replace", () => {
    saveWorkflowGraph("work mode", STEPS_A);
    const replaced = saveWorkflowGraph("work mode", STEPS_B, { replace: true });
    expect(replaced.version).toBe(2);
    expect(getWorkflowGraph("work mode")?.steps).toEqual(STEPS_B);
    expect(getWorkflowGraph("work mode", 1)?.steps).toEqual(STEPS_A);
  });

  it("loads specific version", () => {
    saveWorkflowGraph("study mode", STEPS_A);
    saveWorkflowGraph("study mode", STEPS_B, { replace: true });
    expect(getWorkflowGraph("study mode", 1)?.version).toBe(1);
    expect(getWorkflowGraph("study mode", 2)?.version).toBe(2);
    expect(getWorkflowGraph("study mode")?.version).toBe(2);
  });
});
