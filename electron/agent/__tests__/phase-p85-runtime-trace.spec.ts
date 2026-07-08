import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseDesktopCommand } from "../../automation/desktop/parseDesktopCommand.js";
import {
  beginClarificationRound,
  classifyUtterance,
  clearClarificationContext,
  compoundStickyEnabled,
  resolveClarificationFollowUp,
  runAtomicPlanner,
  runCompoundPlanner,
  runL0Planner,
  runPlannerPipeline,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

function stubWorld(overrides: Partial<WorldModel> = {}): WorldModel {
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

function planTools(
  result: ReturnType<typeof runPlannerPipeline>,
): string[] | null {
  if (result.kind !== "execute") return null;
  return result.plan.steps.map((s) => s.tool);
}

describe("P8.5 utterance classifier", () => {
  it("classifies single clause as atomic", () => {
    expect(classifyUtterance("type hello", "type hello")).toBe("atomic");
    expect(classifyUtterance("open notepad", "open notepad")).toBe("atomic");
  });

  it("classifies workflow compound utterances", () => {
    expect(
      classifyUtterance(
        "open notepad and type hello",
        "open notepad and type hello",
      ),
    ).toBe("compound");
  });

  it("keeps keyboard compounds atomic", () => {
    expect(
      classifyUtterance(
        "select all and copy",
        "select all and copy",
      ),
    ).toBe("atomic");
  });

  it("compound sticky enabled by default", () => {
    expect(compoundStickyEnabled()).toBe(true);
  });
});

describe("P8.5 runtime trace — planner outcomes", () => {
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PHASE_B = "0";
  });

  afterEach(() => {
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("T0-atomic-type: type hello → desktop.type_text", () => {
    const result = runPlannerPipeline({
      command: "type hello",
      world: stubWorld(),
    });
    expect(planTools(result)).toEqual(["desktop.type_text"]);
  });

  it("T0-atomic-open: open notepad → launch_app", () => {
    const result = runPlannerPipeline({
      command: "open notepad",
      world: stubWorld(),
    });
    expect(planTools(result)).toEqual(["desktop.launch_app"]);
  });

  it("T0-compound-ok: open notepad and type hello → two steps", () => {
    const result = runPlannerPipeline({
      command: "open notepad and type hello",
      world: stubWorld(),
    });
    expect(planTools(result)).toEqual([
      "desktop.launch_app",
      "desktop.type_text",
    ]);
  });

  it("T0-compound-fail-comma: open paint, draw a circle — not filesystem.open", () => {
    expect(
      classifyUtterance(
        "Open Paint, draw a circle",
        "open paint, draw a circle",
      ),
    ).toBe("compound");

    const l0 = runL0Planner(
      "Open Paint, draw a circle",
      "open paint, draw a circle",
      stubWorld(),
    );
    expect(l0.kind).toBe("clarify");
    if (l0.kind === "clarify") {
      expect(l0.reason).toBe("compound_unresolved");
    }

    const pipeline = runPlannerPipeline({
      command: "Open Paint, draw a circle",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("clarify");
    if (pipeline.kind === "clarify") {
      expect(pipeline.reason).toBe("compound_unresolved");
    }
    expect(parseDesktopCommand("open paint, draw a circle")).toBeNull();
  });

  it("T0-compound-fail: open paint and draw a circle — not filesystem.open", () => {
    const l0 = runL0Planner(
      "Open Paint and draw a circle",
      "open paint and draw a circle",
      stubWorld(),
    );
    expect(l0.kind).toBe("clarify");
    if (l0.kind === "clarify") {
      expect(l0.reason).toBe("compound_unresolved");
    }

    const pipeline = runPlannerPipeline({
      command: "open paint and draw a circle",
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("clarify");
    if (pipeline.kind === "execute") {
      expect(pipeline.plan.steps.map((s) => s.tool)).not.toContain(
        "filesystem.open",
      );
    }
  });

  it("compound clarify repeat does not duplicate command string", () => {
    clearClarificationContext();
    const cmd = "Open paint and draw a circle";
    beginClarificationRound({
      originalCommand: cmd,
      normalizedUtterance: "open paint and draw a circle",
      question: "clarify draw",
      reason: "compound_unresolved",
      world: stubWorld(),
    });
    expect(resolveClarificationFollowUp(cmd)).toBeNull();
    clearClarificationContext();
  });

  it("grounded clarify does not merge a re-stated send command with STT noise", () => {
    clearClarificationContext();
    beginClarificationRound({
      originalCommand: "Send Phase 3.5 in downloads to Dr. Fatima on WhatsApp",
      normalizedUtterance:
        "send phase 3.5 in downloads to dr. fatima on whatsapp",
      question: "Which file did you mean?",
      reason: "grounded_clarify",
      world: stubWorld(),
    });
    // Same command, minor STT variation (adds "PDF") → treated as retry, not merged.
    const followUp = resolveClarificationFollowUp(
      "Send Phase 3.5 PDF in downloads to Dr. Fatima on WhatsApp",
    );
    expect(followUp).toBeNull();
    clearClarificationContext();
  });

  it("grounded clarify supersedes a full send-to-contact restatement", () => {
    clearClarificationContext();
    beginClarificationRound({
      originalCommand: "Send my resume to Noor",
      normalizedUtterance: "send my resume to noor",
      question: "Which file did you mean?",
      reason: "grounded_clarify",
      world: stubWorld(),
    });
    // A different, self-contained send-item command must not merge/double.
    const followUp = resolveClarificationFollowUp(
      "Send Phase 3.5 from downloads to Dr. Fatima on WhatsApp",
    );
    expect(followUp).toBeNull();
    clearClarificationContext();
  });

  it("T0-save: type notes and save as x.txt includes save_file", () => {
    const result = runPlannerPipeline({
      command: "type meeting notes, save as notes.txt",
      world: stubWorld(),
    });
    const tools = planTools(result);
    expect(tools).toContain("desktop.type_text");
    expect(tools).toContain("desktop.save_file");
  });

  it("parseDesktopCommand rejects compound-tail open targets", () => {
    expect(parseDesktopCommand("open paint and draw a circle")).toBeNull();
    expect(parseDesktopCommand("open paint, draw a circle")).toBeNull();
  });

  it("runCompoundPlanner does not return filesystem.open plan", () => {
    const result = runCompoundPlanner(
      "open paint and draw a circle",
      "open paint and draw a circle",
    );
    expect(result.kind).toBe("clarify");
    if (result.kind === "plan") {
      expect(result.plan.steps.some((s) => s.tool === "filesystem.open")).toBe(
        false,
      );
    }
  });

  it("runAtomicPlanner still handles open downloads", () => {
    const result = runAtomicPlanner(
      "open downloads",
      "open downloads",
      stubWorld(),
    );
    expect(result.kind).toBe("plan");
    if (result.kind === "plan") {
      expect(result.plan.steps[0]?.tool).toBe("filesystem.open");
    }
  });

  it("preserves select all and copy as atomic key sequence", () => {
    const l0 = runL0Planner(
      "select all and copy",
      "select all and copy",
      stubWorld(),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("desktop.press_keys");
    expect(l0.plan.steps[0]?.args.sequence).toBeDefined();
  });
});
