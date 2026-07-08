import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSaveFileCommand } from "../../automation/desktop/parseSaveFileCommand.js";
import { ensureP85ToolsRegistered } from "../planner/toolExecutorBridge.js";
import { classifyClauses } from "../planner/v2/clauseClassifier.js";
import { planCompoundWithV2, planAtomicWithV2 } from "../planner/v2/plannerV2.js";
import { runPlannerPipeline } from "../planner/index.js";
import type { WorldModel } from "../types.js";

function stubWorld(overrides?: Partial<WorldModel>): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: true,
      sendInput: true,
      uia: true,
      ocr: true,
    },
    activeGoal: null,
    ...overrides,
  };
}

function expectCompoundTools(
  command: string,
  expectedTools: string[],
): void {
  const norm = command.toLowerCase();
  const result = planCompoundWithV2(command, norm);
  expect(result?.kind).toBe("plan");
  if (result?.kind !== "plan") return;
  expect(result.plan.steps.map((s) => s.tool)).toEqual(expectedTools);
}

describe("P8.5 E4/E7 matrix — draw + save + clipboard", () => {
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

  describe("save file phrasing", () => {
    it("parses save file test.txt", () => {
      const save = parseSaveFileCommand("save file test.txt");
      expect(save?.filename).toBe("test.txt");
    });

    it("classifies save file tail after app launch", () => {
      const records = classifyClauses(["open chrome", "save file test.txt"]);
      expect(records[0]?.clauseType).toBe("APP_LAUNCH");
      expect(records[1]?.clauseType).toBe("SAVE_FILE");
      expect(records[1]?.entities.saveFilename).toBe("test.txt");
    });

    it("plans open chrome and save file test.txt", () => {
      expectCompoundTools("Open chrome and save file test.txt", [
        "desktop.launch_app",
        "desktop.save_file",
      ]);
    });
  });

  describe("E4 — paint + draw compounds", () => {
    const drawCases = [
      "open paint and draw a circle",
      "open paint and draw rectangle",
      "open paint then draw line",
      "launch paint and draw triangle",
      "open paint and sketch shape",
      "open paint and type draw circle",
    ] as const;

    for (const cmd of drawCases) {
      it(`classifies draw compound: ${cmd}`, () => {
        const result = planCompoundWithV2(cmd, cmd.toLowerCase());
        expect(result?.kind).toBe("plan");
        if (result?.kind !== "plan") return;
        const tools = result.plan.steps.map((s) => s.tool);
        expect(tools[0]).toBe("desktop.launch_app");
        expect(tools).toContain("desktop.mouse_move");
        expect(tools).toContain("desktop.mouse_drag");
        expect(tools).not.toContain("desktop.type_text");
      });
    }
  });

  describe("E7 — clipboard atomics (L0 pipeline)", () => {
    it("read clipboard", () => {
      const result = runPlannerPipeline({
        command: "read clipboard",
        world: stubWorld(),
      });
      expect(result.kind).toBe("execute");
      if (result.kind !== "execute") return;
      expect(result.plan.steps[0]?.tool).toBe("system.clipboard.read");
    });

    it("copy hello world to clipboard", () => {
      const result = runPlannerPipeline({
        command: "copy hello world to clipboard",
        world: stubWorld(),
      });
      expect(result.kind).toBe("execute");
      if (result.kind !== "execute") return;
      expect(result.plan.steps[0]?.tool).toBe("system.clipboard.write");
      expect(result.plan.steps[0]?.args.text).toMatch(/hello world/i);
    });

    it("paste clipboard when clipboard has text", () => {
      const result = runPlannerPipeline({
        command: "paste clipboard",
        world: stubWorld({
          clipboard: { hasText: true, preview: "hi", length: 2 },
        }),
      });
      expect(result.kind).toBe("execute");
      if (result.kind !== "execute") return;
      expect(result.plan.steps[0]?.tool).toBe("desktop.paste");
    });
  });

  describe("E7 — clipboard v2 classifier", () => {
    const basicClipboard = [
      ["select all and copy text", "desktop.press_keys"],
      ["copy this text", "desktop.copy"],
      ["copy selected content", "desktop.copy"],
      ["cut this text", "desktop.press_keys"],
      ["cut selected content", "desktop.press_keys"],
      ["paste this text", "desktop.paste"],
      ["paste clipboard content", "desktop.paste"],
      ["select all and cut text", "desktop.press_keys"],
      ["read clipboard", "system.clipboard.read"],
      ["copy matrix ui test to clipboard", "system.clipboard.write"],
    ] as const;

    for (const [cmd, firstTool] of basicClipboard) {
      it(`classifies clipboard: ${cmd}`, () => {
        const records = classifyClauses([cmd]);
        expect(records[0]?.clauseType).toBe("CLIPBOARD_OP");
        const result = planAtomicWithV2(cmd, cmd.toLowerCase());
        expect(result?.kind).toBe("plan");
        if (result?.kind !== "plan") return;
        expect(result.plan.steps[0]?.tool).toBe(firstTool);
      });
    }

    const compounds = [
      {
        cmd: "copy this text and save file test.txt",
        tools: ["desktop.copy", "desktop.save_file"],
      },
      {
        cmd: "cut this text and save file output.txt",
        tools: ["desktop.press_keys", "desktop.save_file"],
      },
      {
        cmd: "select all and copy then save as notes.txt",
        tools: ["desktop.press_keys", "desktop.save_file"],
      },
      {
        cmd: "copy this and create file data.txt",
        tools: ["desktop.copy", "desktop.save_file"],
      },
      {
        cmd: "copy and save file test.txt",
        tools: ["desktop.copy", "desktop.save_file"],
      },
      {
        cmd: "open notepad, write hello world and second, select all and copy",
        tools: ["desktop.launch_app", "desktop.type_text", "desktop.press_keys"],
      },
      {
        cmd: "open notepad, write hello world and then copy it",
        tools: ["desktop.launch_app", "desktop.type_text", "desktop.press_keys"],
      },
    ] as const;

    for (const { cmd, tools } of compounds) {
      it(`plans compound: ${cmd}`, () => {
        expectCompoundTools(cmd, [...tools]);
      });
    }
  });

  describe("E7 — save phrasing extensions", () => {
    const cases = [
      ["save as project.txt", "project.txt"],
      ["save current file as notes.txt", "notes.txt"],
      ["create new file output.txt", "output.txt"],
      ["create a file called notes", "notes.txt"],
      ["store this text in a file named test.txt", "test.txt"],
      ["save everything as file.txt", "file.txt"],
      ["save file in downloads report.txt", "report.txt"],
    ] as const;

    for (const [cmd, filename] of cases) {
      it(`parses save: ${cmd}`, () => {
        expect(parseSaveFileCommand(cmd)?.filename).toBe(filename);
      });
    }
  });

  describe("E4 — extended draw phrases", () => {
    const phrases = [
      "open paint and draw a star",
      "open paint and draw a smiley face",
      "open paint and draw a heart",
      "open paint and draw a dot",
      "open paint and draw a house",
      "open paint and draw",
      "open paint and draw something",
      "open paint and create drawing of circle",
    ] as const;

    for (const cmd of phrases) {
      it(`plans draw for: ${cmd}`, () => {
        const result = planCompoundWithV2(cmd, cmd.toLowerCase());
        expect(result?.kind).toBe("plan");
        if (result?.kind !== "plan") return;
        const tools = result.plan.steps.map((s) => s.tool);
        expect(tools[0]).toBe("desktop.launch_app");
        expect(tools).toContain("desktop.mouse_drag");
      });
    }
  });

  describe("E1/E2/E3 smoke", () => {
    it("type hello", () => {
      const result = runPlannerPipeline({
        command: "type hello",
        world: stubWorld(),
      });
      expect(result.kind).toBe("execute");
      if (result.kind !== "execute") return;
      expect(result.plan.steps[0]?.tool).toBe("desktop.type_text");
    });

    it("open notepad", () => {
      const result = runPlannerPipeline({
        command: "open notepad",
        world: stubWorld(),
      });
      expect(result.kind).toBe("execute");
      if (result.kind !== "execute") return;
      expect(result.plan.steps[0]?.tool).toBe("desktop.launch_app");
    });

    it("open notepad and type hello", () => {
      expectCompoundTools("open notepad and type hello", [
        "desktop.launch_app",
        "desktop.type_text",
      ]);
    });
  });
});
