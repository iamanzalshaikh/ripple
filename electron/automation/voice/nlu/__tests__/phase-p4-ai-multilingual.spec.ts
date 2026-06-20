import { describe, expect, it } from "vitest";
import {
  MATRIX_STATS,
  PRODUCTION_E2E_MATRIX,
} from "./e2e-matrix.data.js";
import {
  resolveFastPath,
  resolveGptPlan,
  resolveMultilingualCommand,
  shouldReachGptPlanner,
  simulatedGptPlanForKind,
} from "./multilingualPlanner.harness.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("P4 — AI-first multilingual matrix (300+)", () => {
  it(`matrix has ${MATRIX_STATS.total}+ cases`, () => {
    expect(MATRIX_STATS.total).toBeGreaterThanOrEqual(300);
  });

  it("reports coverage by phase", () => {
    expect(Object.keys(MATRIX_STATS.byPhase).length).toBeGreaterThanOrEqual(6);
  });
});

describe("P4 — fast path OR GPT category (no phrase→backend map)", () => {
  const desktopCases = PRODUCTION_E2E_MATRIX.filter((c) => c.route === "desktop");

  it.each(desktopCases.map((c) => [c.id, c] as const))(
    "[%s] %s",
    (_id, spec) => {
      const resolved = resolveMultilingualCommand(spec.phrase, spec.kind);
      expect(resolved.route).toBe("desktop");
      if (spec.kind) {
        expect(resolved.kind).toBe(spec.kind);
      }
      expect(["fast", "gpt"]).toContain(resolved.source);
    },
  );
});

describe("P4 — GPT planner ladder eligibility", () => {
  const gptFallbackTagged = PRODUCTION_E2E_MATRIX.filter(
    (c) =>
      c.tags?.includes("gpt-fallback") &&
      c.route === "desktop" &&
      !resolveFastPath(c.phrase),
  );

  it.each(gptFallbackTagged.slice(0, 40).map((c) => [c.id, c.phrase] as const))(
    "misses fast path but reaches GPT: %s",
    (_id, phrase) => {
      expect(shouldReachGptPlanner(phrase)).toBe(true);
    },
  );

  it("has gpt-fallback cases that miss fast path", () => {
    expect(gptFallbackTagged.length).toBeGreaterThan(10);
  });
});

describe("P4 — negative / chit-chat stays off desktop", () => {
  const negatives = PRODUCTION_E2E_MATRIX.filter((c) => c.route === "none");

  it.each(negatives.map((c) => [c.id, c.phrase] as const))(
    "[%s] %s",
    (_id, phrase) => {
      const fast = resolveFastPath(phrase);
      expect(fast).toBeNull();
      expect(shouldReachGptPlanner(phrase)).toBe(false);
      const nonePlan = resolveGptPlan({
        action: "none",
        entities: {},
        confidence: 0.2,
      });
      expect(nonePlan.route).toBe("none");
    },
  );
});

describe("P4 — GPT action→kind mapping contract", () => {
  const kinds: Array<{ kind: string; expect: string }> = [
    { kind: "folder", expect: "folder" },
    { kind: "smart_search", expect: "smart_search" },
    { kind: "launch_app", expect: "launch_app" },
    { kind: "close_app", expect: "close_app" },
    { kind: "switch_app", expect: "switch_app" },
    { kind: "recall_memory", expect: "recall_memory" },
    { kind: "create_folder", expect: "create_folder" },
    { kind: "create_file", expect: "create_file" },
    { kind: "delete_file", expect: "delete_file" },
    { kind: "rename_file", expect: "rename_file" },
    { kind: "move_file", expect: "move_file" },
    { kind: "system_action", expect: "system_action" },
    { kind: "minimize_all", expect: "launch_app" },
    { kind: "open_workspace", expect: "launch_app" },
  ];

  it.each(kinds)("$kind → $expect via GPT map", ({ kind, expect: expected }) => {
    const plan = simulatedGptPlanForKind(kind);
    expect(plan).not.toBeNull();
    const resolved = resolveGptPlan(plan!);
    expect(resolved.source).toBe("gpt");
    expect(resolved.kind).toBe(expected);
  });
});

describe("P4 — whatsapp / youtube routing unchanged", () => {
  const wa = PRODUCTION_E2E_MATRIX.filter((c) => c.route === "whatsapp");
  it.each(wa.map((c) => [c.id, c.phrase] as const))(
    "[%s] %s",
    (_id, phrase) => {
      const fast = resolveFastPath(phrase);
      expect(fast?.route).toBe("whatsapp");
    },
  );
});
