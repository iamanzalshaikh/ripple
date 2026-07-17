import { describe, expect, it } from "vitest";
import { splitCompoundParts } from "../../automation/voice/nlu/compoundParse.js";
import { preprocessForNlu } from "../../automation/voice/nlu/preprocess.js";
import { normalizeIntent } from "../planner/intentNormalizer.js";
import { parseCreateFileInAppCommand } from "../../automation/desktop/parseCreateFileInAppCommand.js";
import {
  classifyUtterance,
  getCompoundParts,
} from "../planner/utteranceClassifier.js";
import { runL0Planner } from "../planner/l0Planner.js";
import { validatePlan } from "../planner/planValidator.js";
import type { WorldModel } from "../types.js";
import { planCompoundWithV2 } from "../planner/v2/plannerV2.js";

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

describe("create file in cursor — not compound", () => {
  const phrases = [
    "Create a new file server.js in cursor",
    "Create a new file, server.js in cursor",
    "Create a new file server.jsin cursor",
    "create file api.ts in cursor",
  ];

  for (const phrase of phrases) {
    it(`treats "${phrase}" as atomic`, () => {
      const { nlu } = preprocessForNlu(phrase);
      const norm = normalizeIntent(phrase);
      expect(splitCompoundParts(nlu || phrase)).toBeNull();
      expect(getCompoundParts(phrase, norm)).toBeNull();
      expect(classifyUtterance(phrase, norm)).toBe("atomic");
      expect(
        parseCreateFileInAppCommand(phrase) ??
          parseCreateFileInAppCommand(nlu),
      ).toBeTruthy();
    });
  }

  it("plans create file in cursor atomically via L0", () => {
    const l0 = runL0Planner(
      "Create a new file server.js in cursor",
      "create a new file server.js in cursor",
      emptyWorld({
        foreground: {
          hwnd: 1,
          processName: "Cursor.exe",
          windowTitle: "app.tsx - projectRipple - Cursor",
        },
      }),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(
      l0.plan.steps.some((s) => s.tool === "filesystem.write_file"),
    ).toBe(true);
  });

  it("plans write_file via dev cwd when foreground title is weak", () => {
    const l0 = runL0Planner(
      "Create a new file server.js in cursor",
      "create a new file server.js in cursor",
      emptyWorld({
        foreground: {
          hwnd: 1,
          processName: "Cursor",
          windowTitle: "Cursor",
        },
      }),
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    expect(
      l0.plan.steps.some((s) => s.tool === "filesystem.write_file"),
    ).toBe(true);
    expect(l0.plan.steps.some((s) => s.tool === "desktop.save_file")).toBe(
      false,
    );
  });

  it("v2 compound open cursor + create file resolves fully", () => {
    const v2 = planCompoundWithV2(
      "Open cursor and create a new file, server.js in cursor",
      "open cursor and create a new file, server.js in cursor",
    );
    expect(v2?.kind).toBe("plan");
    if (v2?.kind !== "plan") return;
    expect(v2.plan.steps.some((s) => s.tool === "desktop.launch_app")).toBe(
      true,
    );
    expect(
      v2.plan.steps.some(
        (s) =>
          s.tool === "filesystem.write_file" || s.tool === "desktop.save_file",
      ),
    ).toBe(true);
  });

  it("validates create-file plan with empty write_file content", () => {
    const world = emptyWorld({
      foreground: {
        hwnd: 1,
        processName: "Cursor.exe",
        windowTitle: "app.tsx - projectRipple - Cursor",
      },
    });
    const l0 = runL0Planner(
      "Create a new file server.js in cursor",
      "create a new file server.js in cursor",
      world,
    );
    expect(l0.kind).toBe("plan");
    if (l0.kind !== "plan") return;
    const validation = validatePlan(
      l0.plan,
      world,
      "create a new file server.js in cursor",
    );
    expect(validation.valid).toBe(true);
  });
});
