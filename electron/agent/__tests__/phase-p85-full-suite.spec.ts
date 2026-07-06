import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSaveFileCommand } from "../../automation/desktop/parseSaveFileCommand.js";
import { isAtomicClipboardSequence } from "../../automation/voice/nlu/compoundParse.js";
import { classifyUtterance } from "../planner/utteranceClassifier.js";
import { ensureP85ToolsRegistered } from "../planner/toolExecutorBridge.js";
import { classifyClauses } from "../planner/v2/clauseClassifier.js";
import {
  planAtomicWithV2,
  planCompoundWithV2,
} from "../planner/v2/plannerV2.js";

function planTools(command: string): string[] {
  const norm = command.toLowerCase();
  const compound = planCompoundWithV2(command, norm);
  if (compound?.kind === "plan") {
    return compound.plan.steps.map((s) => s.tool);
  }
  const atomic = planAtomicWithV2(command, norm);
  if (atomic?.kind === "plan") {
    return atomic.plan.steps.map((s) => s.tool);
  }
  return [];
}

describe("P8.5 full suite — planner classification", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    ensureP85ToolsRegistered();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  describe("E4 paint + draw", () => {
    const commands = [
      "open paint and draw a circle",
      "open paint and draw a line",
      "open paint and draw a square",
      "open paint and draw a triangle",
      "open paint and draw a rectangle",
      "open paint and draw a star",
      "open paint and draw a smiley face",
      "open paint and draw a dot",
      "open paint and draw a house",
      "open paint and draw a heart",
      "open paint and draw a circle then draw a square",
      "open paint and draw",
      "open paint and draw something",
      "open paint and draw shape",
      "open paint and draw random thing",
      "open paint and create drawing of circle",
    ];

    for (const cmd of commands) {
      it(`plans draw: ${cmd}`, () => {
        const tools = planTools(cmd);
        expect(tools[0]).toBe("desktop.launch_app");
        expect(tools).toContain("desktop.mouse_drag");
      });
    }
  });

  describe("E7 clipboard atomics", () => {
    it("select all and copy this text is atomic not compound", () => {
      expect(isAtomicClipboardSequence("select all and copy this text")).toBe(true);
      expect(
        classifyUtterance("select all and copy this text", "select all and copy this text"),
      ).toBe("atomic");
    });

    it("plans select all and copy this text as one sequence", () => {
      const records = classifyClauses(["select all and copy this text"]);
      expect(records).toHaveLength(1);
      expect(records[0]?.clauseType).toBe("CLIPBOARD_OP");
      expect(records[0]?.entities.clipOp).toBe("select_all_copy");
      const atomic = planAtomicWithV2(
        "select all and copy this text",
        "select all and copy this text",
      );
      expect(atomic?.kind).toBe("plan");
      if (atomic?.kind !== "plan") return;
      expect(atomic.plan.steps.map((s) => s.tool)).toEqual([
        "desktop.select_all",
        "desktop.copy",
      ]);
    });

    const clipCommands = [
      "copy this text",
      "copy selected content",
      "cut this text",
      "paste clipboard content",
      "select all and cut text",
    ];

    for (const cmd of clipCommands) {
      it(`classifies clipboard: ${cmd}`, () => {
        const records = classifyClauses([cmd]);
        expect(records[0]?.clauseType).toBe("CLIPBOARD_OP");
      });
    }
  });

  describe("E7 save phrasing", () => {
    const cases = [
      ["save file test.txt", "test.txt"],
      ["save as project.txt", "project.txt"],
      ["save current file as notes.txt", "notes.txt"],
      ["save file in downloads report.txt", "report.txt"],
      ["create file data.txt", "data.txt"],
      ["create new file output.txt", "output.txt"],
      ["save file final.txt", "final.txt"],
      ["save everything as file.txt", "file.txt"],
      ["create a file called notes", "notes.txt"],
      ["store this text in a file named test.txt", "test.txt"],
    ] as const;

    for (const [cmd, file] of cases) {
      it(`parses: ${cmd}`, () => {
        expect(parseSaveFileCommand(cmd)?.filename).toBe(file);
      });
    }
  });

  describe("E7 compounds", () => {
    const compounds = [
      {
        cmd: "copy this text and save file test.txt",
        tools: ["desktop.copy", "desktop.save_file"],
      },
      {
        cmd: "select all and copy then save as notes.txt",
        tools: ["desktop.select_all", "desktop.copy", "desktop.save_file"],
      },
      {
        cmd: "copy and save file test.txt",
        tools: ["desktop.copy", "desktop.save_file"],
      },
    ];

    for (const { cmd, tools } of compounds) {
      it(`plans compound: ${cmd}`, () => {
        expect(planTools(cmd)).toEqual(tools);
      });
    }
    it("plans fill after triangle draw", () => {
      const tools = planTools("open paint and draw a triangle and fill it");
      expect(tools[0]).toBe("desktop.launch_app");
      expect(tools).toContain("desktop.mouse_drag");
      expect(tools).toContain("desktop.paint_op");
    });
    it("plans draw 3 circles with seven steps", () => {
      const tools = planTools("open paint and draw 3 circles");
      expect(tools[0]).toBe("desktop.launch_app");
      const drags = tools.filter((t) => t === "desktop.mouse_drag").length;
      expect(drags).toBe(3);
      expect(tools.length).toBe(7);
    });
  });
});
