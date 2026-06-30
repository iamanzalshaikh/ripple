import { describe, expect, it, beforeEach } from "vitest";
import {
  parseWorkflowMetaCommand,
  parseWorkflowRunCommand,
} from "../parseWorkflowCommand.js";
import {
  resetWorkflowGraphForTests,
  saveWorkflowGraph,
} from "../../../storage/workflowGraph.js";
import { initRippleDb } from "../../../storage/rippleDb.js";

describe("parseWorkflowCommand P5.5", () => {
  beforeEach(() => {
    initRippleDb();
    resetWorkflowGraphForTests();
    saveWorkflowGraph("work mode", [{ type: "app", target: "vscode" }]);
    saveWorkflowGraph(
      "work mode",
      [{ type: "app", target: "chrome" }],
      { replace: true },
    );
  });

  it("parses replace workflow", () => {
    const intent = parseWorkflowMetaCommand(
      "Replace work mode opens VS Code and Chrome",
    );
    expect(intent?.kind).toBe("remember_workflow");
    if (intent?.kind === "remember_workflow") {
      expect(intent.replace).toBe(true);
      expect(intent.name).toBe("work mode");
    }
  });

  it("runs specific workflow version", () => {
    const intent = parseWorkflowRunCommand("Start work mode v1");
    expect(intent?.kind).toBe("run_workflow");
    if (intent?.kind === "run_workflow") {
      expect(intent.workflow.version).toBe(1);
      expect(intent.workflow.steps[0]?.target).toBe("vscode");
    }
  });

  it("runs latest workflow version by default", () => {
    const intent = parseWorkflowRunCommand("Start work mode");
    expect(intent?.kind).toBe("run_workflow");
    if (intent?.kind === "run_workflow") {
      expect(intent.workflow.version).toBe(2);
      expect(intent.workflow.steps[0]?.target).toBe("chrome");
    }
  });

  it("parses Hinglish work mode chalu karo", () => {
    const intent = parseWorkflowRunCommand("work mode chalu karo");
    expect(intent?.kind).toBe("run_workflow");
    if (intent?.kind === "run_workflow") {
      expect(intent.workflow.name).toBe("work mode");
    }
  });

  it("parses list workflow singular", () => {
    expect(parseWorkflowMetaCommand("List Workflow")?.kind).toBe("list_workflows");
    expect(parseWorkflowMetaCommand("List workflows")?.kind).toBe("list_workflows");
  });
});
