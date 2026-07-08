import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRegisteredToolsForTests } from "../planner/toolRegistry.js";
import {
  registerPhase1BrowserTools,
  resetPhase1BrowserToolsForTests,
} from "../planner/tools/browserTools.js";
import { tryL0GmailPlan } from "../planner/l0GmailPlanner.js";
import {
  buildExecutorPayload,
  runPlannerPipeline,
  shouldBypassP85Planner,
  tryCompoundGate,
} from "../planner/index.js";
import type { WorldModel } from "../types.js";

vi.mock("../../automation/gmailComposeUrl.js", () => ({
  openGmailCompose: vi.fn(async () => "Gmail compose opened"),
  buildGmailComposeUrl: vi.fn(() => "https://mail.google.com/mail/u/0/#compose=new"),
}));

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

describe("P8.5 Gmail tool planner", () => {
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

  it("does not bypass P85 for gmail compose utterances", () => {
    expect(
      shouldBypassP85Planner(
        "Write a mail to sheikhanzal95 at gmail.com about full site developer application",
      ),
    ).toBe(false);
  });

  it("plans open gmail via browser.open_workspace", () => {
    const result = tryL0GmailPlan("Open Gmail", "open gmail");
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.open_workspace");
    expect(result.plan.steps[0]?.args.workspaceId).toBe("gmail");
  });

  it("plans compose mail via browser.gmail.compose", () => {
    const cmd =
      "Write a mail to sheikhanzal95 at gmail.com about full site developer application";
    const result = tryL0GmailPlan(cmd, cmd.toLowerCase());
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("browser.gmail.compose");
    expect(result.plan.steps[0]?.args.to).toBe("sheikhanzal95@gmail.com");
    expect(result.plan.steps[0]?.args.subject).toMatch(/full site developer/i);
  });

  it("defers compose-topic-only to GPT", () => {
    const result = tryL0GmailPlan(
      "Compose an email to the hiring manager",
      "compose an email to the hiring manager",
    );
    expect(result?.kind).toBe("defer");
    if (result?.kind !== "defer") return;
    expect(result.reason).toBe("compose_needs_llm");
  });

  it("compound gate skips gmail utterances", () => {
    const gate = tryCompoundGate(
      "Write a mail to salik at gmail.com about interview",
      "write a mail to salik at gmail.com about interview",
    );
    expect(gate).toBeNull();
  });

  it("pipeline executes gmail compose via L0 tools", () => {
    const cmd =
      "Write a mail to sheikhanzal95 at gmail.com about full site developer application";
    const pipeline = runPlannerPipeline({
      command: cmd,
      world: stubWorld(),
    });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(pipeline.plan.steps[0]?.tool).toBe("browser.gmail.compose");
  });

  it("executor payload bridges browser.gmail.compose", () => {
    const cmd = "Write mail to john@gmail.com about interview";
    const plan = tryL0GmailPlan(cmd, cmd.toLowerCase());
    if (plan?.kind !== "plan") throw new Error("expected plan");
    const bridged = buildExecutorPayload(plan.plan, cmd, stubWorld());
    expect(bridged.kind).not.toBe("invalid");
  });
});
