import { describe, expect, it } from "vitest";
import {
  P85_UTTERANCE_FIXTURES,
  type UtteranceFixture,
} from "../planner/utteranceFixtures.js";
import { runPlannerPipeline } from "../planner/plannerPipeline.js";
import type { WorldModel } from "../types.js";

function fixtureWorld(overrides?: UtteranceFixture["worldOverrides"]): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: overrides?.calculatorFocused
      ? {
          hwnd: 1,
          processName: "Calculator",
          windowTitle: "Calculator",
          rect: { left: 0, top: 0, right: 100, bottom: 100 },
        }
      : null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, windowUnderCursor: null },
    browser: { surface: "whatsapp" },
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

describe("P8.5 utterance regression fixtures", () => {
  for (const fixture of P85_UTTERANCE_FIXTURES) {
    describe(fixture.id, () => {
      for (const utterance of fixture.utterances) {
        it(`"${utterance}" → ${fixture.expectedTool}`, () => {
          const world = fixtureWorld(fixture.worldOverrides);
          const result = runPlannerPipeline({ command: utterance, world });

          if (fixture.expectedTool === "__defer__") {
            expect(result.kind).toBe("defer");
            if (fixture.id === "compose_defer" && result.kind === "defer") {
              expect(result.reason).toBe("compose_needs_llm");
            }
            if (fixture.id === "paste_reject_empty_clipboard" && result.kind === "defer") {
              expect(result.reason).toMatch(/validation_failed|no_l0_match/);
            }
            return;
          }
          if (fixture.expectedTool === "__clarify__") {
            expect(result.kind).toBe("clarify");
            return;
          }

          expect(result.kind).toBe("execute");
          if (result.kind !== "execute") return;

          if (fixture.expectedStepCount) {
            expect(result.plan.steps).toHaveLength(fixture.expectedStepCount);
          }

          const tool = result.plan.steps[0]?.tool;
          expect(tool).toBe(fixture.expectedTool);

          if (fixture.expectedText && tool === "desktop.type_text") {
            const text = String(result.plan.steps[0]?.args.text ?? "");
            if (utterance.includes("put hello there")) {
              expect(text).toBe("hello there");
            } else {
              expect(text).toBe(fixture.expectedText);
            }
          }
        });
      }
    });
  }
});
