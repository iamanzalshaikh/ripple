import { describe, expect, it, beforeEach } from "vitest";
import {
  clearPlannerMemoryForTests,
  lookupBinding,
  PLANNER_MEMORY_DEFAULT_TTL_MS,
  recordBinding,
} from "../planner/plannerMemory.js";
import {
  bindStepArgs,
  resolveAppPhrase,
  tryResolveLaunchIntent,
} from "../planner/entityResolver.js";
import {
  clearCapabilitySnapshotCacheForTests,
} from "../planner/capabilitySnapshotCache.js";
import {
  getCapabilitySnapshot,
  canRipple,
} from "../planner/capabilityService.js";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import { PLANNER_VERSION } from "../planner/plannerConstants.js";
import { TOOL_MANIFEST_VERSION } from "../planner/toolDefinitions.js";
import type { WorldModel } from "../types.js";

function stubWorld(): WorldModel {
  return {
    capturedAt: 42,
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
      ocr: false,
    },
    activeGoal: null,
  };
}

describe("P8.5 Phase 2 — pipeline wiring", () => {
  beforeEach(() => {
    clearPlannerMemoryForTests();
    clearCapabilitySnapshotCacheForTests();
  });

  it("stamps plannerVersion on execute plans", () => {
    const result = runPlannerPipeline({ command: "type hello", world: stubWorld() });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.plannerVersion).toBe(PLANNER_VERSION);
    expect(result.plan.toolManifestVersion).toBe(TOOL_MANIFEST_VERSION);
    expect(result.plan.worldVersion).toBe("42");
  });

  it("capability snapshot includes registered desktop tools", async () => {
    const snap = await getCapabilitySnapshot(stubWorld());
    expect(snap.registeredTools).toContain("desktop.type_text");
    expect(snap.registeredTools).toContain("desktop.launch_app");
    expect(canRipple("tool:desktop.copy", snap)).toBe(true);
    expect(canRipple("desktop", snap)).toBe(true);
  });

  it("planner memory resolves custom app phrase via entity resolver", () => {
    recordBinding({
      phrase: "hrms",
      kind: "app",
      target: "notepad",
      confidence: 0.95,
    });

    expect(resolveAppPhrase("hrms")?.id).toBe("notepad");
    const launch = tryResolveLaunchIntent("open hrms");
    expect(launch?.kind).toBe("launch_app");
    if (launch?.kind !== "launch_app") return;
    expect(launch.app.id).toBe("notepad");
  });

  it("L0 uses planner memory for open phrase", () => {
    recordBinding({
      phrase: "hrms",
      kind: "app",
      target: "notepad",
      confidence: 0.95,
    });

    const result = runPlannerPipeline({ command: "open hrms", world: stubWorld() });
    expect(result.kind).toBe("execute");
    if (result.kind !== "execute") return;
    expect(result.plan.steps[0]?.tool).toBe("desktop.launch_app");
    expect(result.plan.steps[0]?.reason).toBe("planner_memory_app");
  });

  it("bindStepArgs expands launch app string to native intent", async () => {
    const bound = await bindStepArgs(
      "desktop.launch_app",
      { app: "notepad" },
      {},
    );
    expect(bound._nativeIntent).toBeDefined();
    expect(bound.app).toBe("notepad");
  });

  it("expires planner memory bindings after TTL", () => {
    recordBinding({
      phrase: "oldapp",
      kind: "app",
      target: "notepad",
      confidence: 0.95,
    });

    const row = lookupBinding("oldapp");
    expect(row).not.toBeNull();
    if (!row) return;

    row.validatedAt = Date.now() - PLANNER_MEMORY_DEFAULT_TTL_MS - 1;
    expect(lookupBinding("oldapp")).toBeNull();
  });
});
