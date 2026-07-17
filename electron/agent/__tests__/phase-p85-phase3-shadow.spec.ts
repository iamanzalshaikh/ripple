import { describe, expect, it, beforeEach } from "vitest";
import {
  P85_UTTERANCE_FIXTURES,
  type UtteranceFixture,
} from "../planner/utteranceFixtures.js";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import { buildExecutorPayload } from "../planner/plannerExecutor.js";
import {
  comparePlanToLegacyPayload,
  isLegacyNoopOnly,
  planUsesP85ExtensionTools,
  resolveLegacyDesktopPayload,
  runShadowParityOnExecute,
} from "../planner/shadowParity.js";
import {
  getRouterParitySnapshot,
  recordP85Execute,
  resetRouterParity,
} from "../planner/routerParity.js";
import type { WorldModel } from "../types.js";

const SHADOW_PARITY_FIXTURE_IDS = new Set([
  "type_text_hello",
  "type_text_sentence",
  "copy_selection",
  "select_all",
  "paste_clipboard",
  "open_notepad",
  "open_chrome",
  "open_downloads",
  "open_documents",
  "open_desktop_folder",
]);

function fixtureWorld(
  overrides?: UtteranceFixture["worldOverrides"] & {
    foreground?: WorldModel["foreground"];
  },
): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: overrides?.foreground ?? null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: null },
    clipboard: {
      hasText: overrides?.clipboardHasText === true,
      preview: "",
      length: overrides?.clipboardHasText ? 10 : 0,
    },
    capabilities: {
      sidecarConnected: true,
      sendInput: true,
      uia: true,
      ocr: true,
    },
    activeGoal: null,
  };
}

const shadowFixtures = P85_UTTERANCE_FIXTURES.filter((f) =>
  SHADOW_PARITY_FIXTURE_IDS.has(f.id),
);

describe("P8.5 Phase 3 — shadow parity", () => {
  beforeEach(() => {
    resetRouterParity();
    process.env.RIPPLE_P85_SHADOW_COMPARE = "1";
  });

  describe("plan vs legacy payload", () => {
    for (const fixture of shadowFixtures) {
      describe(fixture.id, () => {
        for (const utterance of fixture.utterances) {
          it(`"${utterance}" matches legacy router`, () => {
            const world = fixtureWorld(fixture.worldOverrides);
            const pipeline = runPlannerPipeline({ command: utterance, world });
            expect(pipeline.kind).toBe("execute");
            if (pipeline.kind !== "execute") return;

            const legacy = resolveLegacyDesktopPayload(utterance);
            if (!legacy) {
              // P8.5 extends beyond legacy routers — no compare target.
              return;
            }

            const parity = comparePlanToLegacyPayload(
              pipeline.plan,
              utterance,
              legacy,
            );
            expect(parity.matched, parity.reason).toBe(true);
          });
        }
      });
    }
  });

  it("buildExecutorPayload succeeds for shadow fixtures", () => {
    const utterance = "type hello";
    const world = fixtureWorld();
    const pipeline = runPlannerPipeline({ command: utterance, world });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;

    const built = buildExecutorPayload(pipeline.plan, utterance, world);
    expect(built.kind === "payload" || built.kind === "executor").toBe(true);
    if (built.kind !== "payload" && built.kind !== "executor") return;
    expect(built.payload.actions?.length).toBeGreaterThan(0);
  });

  it("runShadowParityOnExecute does not record mismatch for type hello", () => {
    const utterance = "type hello";
    const world = fixtureWorld();
    const pipeline = runPlannerPipeline({ command: utterance, world });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;

    const built = buildExecutorPayload(pipeline.plan, utterance, world);
    if (built.kind !== "payload" && built.kind !== "executor") return;

    const parity = runShadowParityOnExecute(
      utterance,
      pipeline.plan,
      built.payload,
    );
    expect(parity?.matched).toBe(true);
    expect(getRouterParitySnapshot().mismatchTotal).toBe(0);
  });

  it("skips shadow compare for create-file-in-cursor (P85 extension)", () => {
    const utterance = "create a new file server.js in cursor";
    const world = fixtureWorld({
      foreground: {
        hwnd: 1,
        processName: "Cursor",
        windowTitle: "app.tsx - projectRipple - Cursor",
      },
    });
    const pipeline = runPlannerPipeline({ command: utterance, world });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(planUsesP85ExtensionTools(pipeline.plan)).toBe(true);

    const built = buildExecutorPayload(pipeline.plan, utterance, world);
    if (built.kind !== "payload" && built.kind !== "executor") return;

    const legacy = resolveLegacyDesktopPayload(utterance);
    if (legacy) {
      expect(isLegacyNoopOnly(legacy.payload)).toBe(true);
    }

    const parity = runShadowParityOnExecute(
      utterance,
      pipeline.plan,
      built.payload,
    );
    expect(parity).toBeNull();
    expect(getRouterParitySnapshot().mismatchTotal).toBe(0);
  });

  it("plans create-file-in-cursor without legacy parity requirement", () => {
    const utterance = "create file api.ts in cursor";
    const world = fixtureWorld();
    const pipeline = runPlannerPipeline({ command: utterance, world });
    expect(pipeline.kind).toBe("execute");
    if (pipeline.kind !== "execute") return;
    expect(
      pipeline.plan.steps.some((s) => s.tool === "filesystem.write_file"),
    ).toBe(true);
    expect(planUsesP85ExtensionTools(pipeline.plan)).toBe(true);
  });

  it("readyForDeprecation after shadow fixture passes", () => {
    for (const fixture of shadowFixtures) {
      const utterance = fixture.utterances[0]!;
      const world = fixtureWorld(fixture.worldOverrides);
      const pipeline = runPlannerPipeline({ command: utterance, world });
      if (pipeline.kind !== "execute") continue;

      const legacy = resolveLegacyDesktopPayload(utterance);
      if (!legacy) continue;

      const parity = comparePlanToLegacyPayload(
        pipeline.plan,
        utterance,
        legacy,
      );
      expect(parity.matched, `${fixture.id}: ${parity.reason}`).toBe(true);
      recordP85Execute();
    }

    while (getRouterParitySnapshot().p85Executes < 20) {
      recordP85Execute();
    }

    const snap = getRouterParitySnapshot();
    expect(snap.mismatchTotal).toBe(0);
    expect(snap.p85Executes).toBeGreaterThanOrEqual(20);
    expect(snap.readyForDeprecation).toBe(true);
  });
});
