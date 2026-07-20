import { describe, expect, it } from "vitest";
import { tryL0OsControlPlan } from "../planner/l0OsControlPlanner.js";

/**
 * W0.2 — "compare these two folders A and B" must resolve to
 * filesystem.compare_directories via the early L0 chain, before the
 * compound gate / planner-v2 ever see the utterance (both would otherwise
 * split on "and" and drop the command — see FEATURE_GAPS §3.2).
 */
describe("P8.5-P5.6 W0 — compare-folders routing", () => {
  it("routes the exact bug.md phrasing", () => {
    const cmd =
      "Compare these two folders C:\\Users\\ANZAL\\Desktop\\CompareA and C:\\Users\\ANZAL\\Desktop\\CompareB";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.compare_directories");
    expect(result.plan.steps[0]?.args?.left).toBe(
      "C:\\Users\\ANZAL\\Desktop\\CompareA",
    );
    expect(result.plan.steps[0]?.args?.right).toBe(
      "C:\\Users\\ANZAL\\Desktop\\CompareB",
    );
  });

  it("still routes the original 'compare the folders A and B' phrasing", () => {
    const cmd = "compare the folders CompareA and CompareB";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.compare_directories");
  });

  it("routes without any article ('compare folders A and B')", () => {
    const cmd = "compare folders CompareA and CompareB";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.compare_directories");
  });

  it("routes 'compare these two files A and B'", () => {
    const cmd = "compare these two files a.txt and b.txt";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.compare_files");
  });

  it("routes the exact live-log phrasing with a comma after 'folders'", () => {
    const cmd = "Compare these two folders, CompareA and CompareB in downloads";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.compare_directories");
    expect(result.plan.steps[0]?.args?.left).toBe("CompareA");
    expect(result.plan.steps[0]?.args?.right).toBe("CompareB");
  });

  it("routes the no-comma live-log phrasing and strips the trailing location", () => {
    const cmd = "Compare these two folders CompareA and CompareB in downloads";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.compare_directories");
    expect(result.plan.steps[0]?.args?.left).toBe("CompareA");
    expect(result.plan.steps[0]?.args?.right).toBe("CompareB");
  });
});
