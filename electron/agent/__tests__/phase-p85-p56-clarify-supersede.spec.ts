import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  beginClarificationRound,
  clearClarificationContext,
  resolveClarificationFollowUp,
} from "../planner/clarificationEngine.js";
import type { WorldModel } from "../types.js";

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, deviceUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: false,
      sendInput: true,
      uia: false,
      ocr: false,
      globalHotkey: false,
      elevationInjection: false,
    },
  };
}

/**
 * W0.4 — a fresh, self-contained voice command must supersede a stale
 * pending clarify, never be absorbed into it. Regression for bug.md: after
 * "Compare these two folders..." got stuck pending, "Inspect the cursor
 * window" (short, but a complete verb+object command) was incorrectly
 * merged into the unrelated compare clarify instead of running on its own.
 */
describe("P8.5-P5.6 W0.4 — clarify supersede on new short command", () => {
  beforeEach(() => clearClarificationContext());
  afterEach(() => clearClarificationContext());

  it("a short but complete new command supersedes a stuck compound_unresolved clarify", () => {
    beginClarificationRound({
      originalCommand:
        "Compare these two folders C:\\Users\\ANZAL\\Desktop\\CompareA and C:\\Users\\ANZAL\\Desktop\\CompareB",
      normalizedUtterance:
        "compare these two folders c:\\users\\anzal\\desktop\\comparea and c:\\users\\anzal\\desktop\\compareb",
      question: "I couldn't fully resolve that. Can you clarify?",
      reason: "compound_unresolved",
      world: stubWorld(),
    });

    const result = resolveClarificationFollowUp("Inspect the cursor window");
    expect(result).toBeNull();
  });

  it("still merges a genuinely short disambiguation answer", () => {
    beginClarificationRound({
      originalCommand: "Open my project",
      normalizedUtterance: "open my project",
      question: "Which project — school-management or horizon-backend?",
      reason: "compound_unresolved",
      world: stubWorld(),
    });

    const result = resolveClarificationFollowUp("horizon-backend");
    expect(result?.mergedCommand).toContain("horizon-backend");
  });
});
