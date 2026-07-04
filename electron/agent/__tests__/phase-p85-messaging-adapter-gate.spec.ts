import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runPlannerPipeline,
  shouldBypassP85Planner,
  shouldBlockLegacyDesktopRouters,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

function stubWorld(): WorldModel {
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
  };
}

describe("P8.5 messaging adapter gate", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("bypasses P85 for whatsapp utterances", () => {
    expect(shouldBypassP85Planner("Open WhatsApp")).toBe(true);
    expect(
      shouldBypassP85Planner(
        "Open WhatsApp and search Dr. Fatima and ask how are you",
      ),
    ).toBe(true);
  });

  it("does not bypass P85 for youtube workspace opens", () => {
    expect(shouldBypassP85Planner("Open YouTube")).toBe(false);
    expect(shouldBypassP85Planner("Open YouTube and search cats")).toBe(false);
    expect(shouldBlockLegacyDesktopRouters("Open YouTube")).toBe(true);
  });

  it("compound gate skips whatsapp compounds", () => {
    const gate = tryCompoundGate(
      "Open WhatsApp and search Dr. Fatima and ask how are you",
      "open whatsapp and search dr. fatima and ask how are you",
    );
    expect(gate).toBeNull();
  });

  it("pipeline defers open whatsapp instead of v2 clarify", () => {
    const result = runPlannerPipeline({
      command: "Open WhatsApp",
      world: stubWorld(),
    });
    expect(result.kind).toBe("defer");
    if (result.kind === "defer") {
      expect(result.reason).toBe("adapter_owned");
    }
  });

  it("bypasses P85 for gmail compose utterances", () => {
    expect(
      shouldBypassP85Planner(
        "Write a mail to sheikhanzal95 at gmail.com about full site developer application",
      ),
    ).toBe(true);
  });

  it("routes session recall and remember workflow through P85 legacy bridge", () => {
    expect(shouldBypassP85Planner("Open last pdf I opened")).toBe(false);
    expect(
      shouldBypassP85Planner(
        "Remember my work mode open YouTube, Paint and Calculator",
      ),
    ).toBe(false);
    expect(shouldBypassP85Planner("Remember test is in downloads")).toBe(false);

    const recall = runPlannerPipeline({
      command: "Open last pdf I opened",
      world: stubWorld(),
    });
    expect(recall.kind).toBe("execute");

    const workflow = runPlannerPipeline({
      command: "Remember my work mode open YouTube, Paint and Calculator",
      world: stubWorld(),
    });
    expect(workflow.kind).toBe("execute");

    expect(shouldBypassP85Planner("Open my portfolio")).toBe(false);
  });

  it("does not bypass remember workflow when gmail is only a workflow step", () => {
    expect(
      shouldBypassP85Planner(
        "Remember work mode open YouTube, Gmail, Calculator",
      ),
    ).toBe(false);
  });

  it("does not treat write hello as gmail bypass", () => {
    expect(shouldBypassP85Planner("write hello world")).toBe(false);
  });
});
