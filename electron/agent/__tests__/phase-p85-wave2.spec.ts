import { describe, expect, it, beforeEach } from "vitest";
import {
  buildPlanCacheKey,
  clearPlanCache,
  isPlanCacheable,
  lookupCachedPlan,
  planCacheSize,
  storeCachedPlan,
  evaluatePlanConfidence,
  passesConfidenceGate,
  beginClarificationRound,
  clearClarificationContext,
  hasPendingClarification,
  resolveClarificationFollowUp,
  classifyExecutionFailure,
} from "../planner/index.js";
import type { ExecutionPlan, WorldModel } from "../planner/planTypes.js";

function emptyWorld(overrides: Partial<WorldModel> = {}): WorldModel {
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

function gptPlan(confidence: number, tool = "desktop.type_text"): ExecutionPlan {
  return {
    goal: "test",
    confidence,
    steps: [{ tool, args: { text: "hello" } }],
    rawUtterance: "test",
    normalizedUtterance: "test",
    source: "GPT",
  };
}

describe("P8.5 plan cache", () => {
  beforeEach(() => {
    clearPlanCache();
  });

  it("stores and retrieves GPT plans", () => {
    const world = emptyWorld();
    const plan = gptPlan(0.9);
    storeCachedPlan("open chrome", world, plan);
    expect(planCacheSize()).toBe(1);
    const hit = lookupCachedPlan("open chrome", world);
    expect(hit?.source).toBe("cache");
    expect(hit?.steps[0]?.tool).toBe("desktop.type_text");
  });

  it("does not cache L0 or communication tools", () => {
    expect(isPlanCacheable({ ...gptPlan(0.9), source: "L0" })).toBe(false);
    expect(
      isPlanCacheable({
        ...gptPlan(0.9),
        steps: [{ tool: "browser.whatsapp.send", args: { message: "hi" } }],
      }),
    ).toBe(false);
  });

  it("keys include clipboard state for paste-sensitive plans", () => {
    const a = buildPlanCacheKey("paste here", emptyWorld());
    const b = buildPlanCacheKey(
      "paste here",
      emptyWorld({ clipboard: { hasText: true, preview: "x", length: 1 } }),
    );
    expect(a).not.toBe(b);
  });
});

describe("P8.5 confidence engine", () => {
  it("executes high-confidence GPT plans", () => {
    expect(passesConfidenceGate(gptPlan(0.85))).toBe(true);
    expect(evaluatePlanConfidence(gptPlan(0.85)).action).toBe("execute");
  });

  it("allows best-effort band between thresholds", () => {
    const decision = evaluatePlanConfidence(gptPlan(0.55));
    expect(decision.action).toBe("execute_best_effort");
    expect(passesConfidenceGate(gptPlan(0.55))).toBe(true);
  });

  it("clarifies very low confidence", () => {
    const decision = evaluatePlanConfidence(gptPlan(0.15));
    expect(decision.action).toBe("clarify");
    expect(passesConfidenceGate(gptPlan(0.15))).toBe(false);
  });

  it("executes best effort at voice-friendly mid band", () => {
    const decision = evaluatePlanConfidence(gptPlan(0.35));
    expect(decision.action).toBe("execute_best_effort");
    expect(passesConfidenceGate(gptPlan(0.35))).toBe(true);
  });

  it("requires higher confidence for close_window", () => {
    const plan: ExecutionPlan = {
      ...gptPlan(0.85, "desktop.close_window"),
      steps: [{ tool: "desktop.close_window", args: { title: "Notepad" } }],
    };
    expect(passesConfidenceGate(plan)).toBe(false);
  });
});

describe("P8.5 clarification engine", () => {
  beforeEach(() => {
    clearClarificationContext();
  });

  it("merges follow-up answers into original command", () => {
    beginClarificationRound({
      originalCommand: "Send this to Ahmed",
      normalizedUtterance: "send this to ahmed",
      question: "Which Ahmed?",
      reason: "ambiguous_recipient",
      world: emptyWorld(),
    });
    expect(hasPendingClarification()).toBe(true);
    const merged = resolveClarificationFollowUp("on WhatsApp");
    expect(merged?.mergedCommand).toContain("Send this to Ahmed");
    expect(merged?.mergedCommand).toContain("WhatsApp");
    expect(hasPendingClarification()).toBe(false);
  });

  it("compound_unresolved: same command repeat does not concatenate", () => {
    const cmd = "Open paint and draw a circle";
    beginClarificationRound({
      originalCommand: cmd,
      normalizedUtterance: cmd,
      question: 'I am not sure how to "draw a circle"',
      reason: "compound_unresolved",
      world: emptyWorld(),
    });
    const retry = resolveClarificationFollowUp("Open paint and draw a circle.");
    expect(retry).toBeNull();
    expect(hasPendingClarification()).toBe(false);
  });

  it("compound_unresolved: and vs comma phrasing is a retry, not an answer", () => {
    const cmd = "Open paint and draw a circle";
    beginClarificationRound({
      originalCommand: cmd,
      normalizedUtterance: "Open paint, draw a circle",
      question: 'I am not sure how to "draw a circle"',
      reason: "compound_unresolved",
      world: emptyWorld(),
    });
    const retry = resolveClarificationFollowUp("Open paint and draw a circle");
    expect(retry).toBeNull();
    expect(hasPendingClarification()).toBe(false);
  });

  it("compound_unresolved: minor wording drift is a retry, not an answer", () => {
    const cmd = "Open paint and draw a circle";
    beginClarificationRound({
      originalCommand: cmd,
      normalizedUtterance: cmd,
      question: 'I am not sure how to "draw a circle"',
      reason: "compound_unresolved",
      world: emptyWorld(),
    });
    const retry = resolveClarificationFollowUp("Open paint and draw circle");
    expect(retry).toBeNull();
    expect(hasPendingClarification()).toBe(false);
  });

  it("compound_unresolved: different answer does not inflate command string", () => {
    const cmd = "Open paint and draw a circle";
    beginClarificationRound({
      originalCommand: cmd,
      normalizedUtterance: cmd,
      question: 'I am not sure how to "draw a circle"',
      reason: "compound_unresolved",
      world: emptyWorld(),
    });
    const merged = resolveClarificationFollowUp("use the ellipse tool");
    expect(merged?.mergedCommand).toContain(cmd);
    expect(merged?.mergedCommand).toContain("use the ellipse tool");
    expect(hasPendingClarification()).toBe(false);
  });

  it("compound_unresolved: new multi-step command supersedes pending clarify", () => {
    beginClarificationRound({
      originalCommand: "Switch to Chrome and open YouTube",
      normalizedUtterance: "switch to chrome and open youtube",
      question: "clarify",
      reason: "compound_unresolved",
      world: emptyWorld(),
    });
    const next = resolveClarificationFollowUp(
      "Open paint and switch to chrome and search cats",
    );
    expect(next).toBeNull();
    expect(hasPendingClarification()).toBe(false);
  });

  it("supersedes stale clarify when user says a complete save command", () => {
    beginClarificationRound({
      originalCommand: "Save as, save.txt",
      normalizedUtterance: "save as, save.txt",
      question: "clarify",
      reason: "compound_unresolved",
      world: emptyWorld(),
    });
    const next = resolveClarificationFollowUp("Save this notepad as save.txt");
    expect(next).toBeNull();
    expect(hasPendingClarification()).toBe(false);
  });
});

describe("P8.5 recovery engine", () => {
  it("classifies transient focus errors", () => {
    expect(classifyExecutionFailure("Failed to focus window")).toBe("transient");
  });

  it("classifies permission errors as hard", () => {
    expect(classifyExecutionFailure("Permission blocked by policy")).toBe("hard");
  });

  it("classifies stale window errors", () => {
    expect(classifyExecutionFailure("Window not found")).toBe("stale_plan");
  });
});
