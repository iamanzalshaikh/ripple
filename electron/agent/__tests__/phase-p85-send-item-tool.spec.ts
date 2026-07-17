import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0SendItemToContactPlan } from "../planner/l0SendItemPlanner.js";
import { runPlannerPipeline } from "../planner/index.js";
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

describe("P8.5 send-item compound planner", () => {
  const prevV2 = process.env.RIPPLE_P85_PLANNER_V2;
  const prevPhaseB = process.env.RIPPLE_P85_PHASE_B;

  beforeEach(() => {
    process.env.RIPPLE_P85_PLANNER_V2 = "all";
    process.env.RIPPLE_P85_PHASE_B = "1";
    clearRegisteredToolsForTests();
    resetPhase1BrowserToolsForTests();
    registerPhase1BrowserTools();
  });

  afterEach(() => {
    if (prevV2 === undefined) delete process.env.RIPPLE_P85_PLANNER_V2;
    else process.env.RIPPLE_P85_PLANNER_V2 = prevV2;
    if (prevPhaseB === undefined) delete process.env.RIPPLE_P85_PHASE_B;
    else process.env.RIPPLE_P85_PHASE_B = prevPhaseB;
  });

  it("plans send Phase 3.5 from downloads to contact via filesystem.open + whatsapp", () => {
    const cmd =
      "Send Phase 3.5 PDF in downloads to Dr. Fatima on WhatsApp";
    const result = tryL0SendItemToContactPlan(cmd, cmd.toLowerCase());
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps).toHaveLength(2);
    expect(result.plan.steps[0]?.tool).toBe("filesystem.open");
    expect(result.plan.steps[0]?.args.itemName).toBe("Phase 3.5");
    expect(result.plan.steps[0]?.args.parentFolder).toBe("downloads");
    expect(result.plan.steps[1]?.tool).toBe("browser.whatsapp.send");
    expect(result.plan.steps[1]?.args.contact).toBe("Dr. Fatima");
    expect(result.plan.steps[1]?.args.mode).toBe("referential_send");
    expect(result.plan.steps[1]?.dependsOnTools).toContain("filesystem.open");
  });

  it("pipeline executes send-item plan before compound clarify", () => {
    const result = runPlannerPipeline({
      command:
        "Send Phase 3.5 PDF in downloads to Dr. Fatima on WhatsApp",
      world: stubWorld(),
    });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.open");
    expect(result.plan.steps[1]?.tool).toBe("browser.whatsapp.send");
  });
});
