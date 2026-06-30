import { describe, expect, it } from "vitest";
import { buildDesktopCommandResult } from "../../desktop/desktopCommand.js";
import { parseWorkflowSteps } from "../../actions/showSuggestions.js";
import { expandWorkflowSteps } from "../actionExpander.js";
import { useFreshNluCache } from "../../voice/nlu/__tests__/testHelpers.js";

useFreshNluCache();

describe("compound WORKFLOW expansion (orchestrator path)", () => {
  it("builds WORKFLOW with two prebuilt desktop batch steps", () => {
    const payload = buildDesktopCommandResult(
      "Open last pdf I opened. Open last folder I opened",
    );
    expect(payload?.intent).toBe("workflow");
    expect(payload?.actions).toHaveLength(1);
    expect(payload?.actions?.[0]?.type).toBe("WORKFLOW");

    const steps = parseWorkflowSteps(payload!.actions![0]!);
    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.data?._desktopBatch === true)).toBe(true);

    const expanded = expandWorkflowSteps(steps);
    expect(expanded).toHaveLength(2);
    expect(
      expanded.every(
        (s) =>
          s.kind === "local" &&
          (s.action.data as Record<string, unknown>)?._desktopBatch === true,
      ),
    ).toBe(true);

    const kinds = expanded.map(
      (s) => (s.action.data as Record<string, unknown>).desktopKind,
    );
    expect(kinds).toEqual(["recall_memory", "recall_memory"]);
  });
});
