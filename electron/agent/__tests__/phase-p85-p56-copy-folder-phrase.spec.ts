import { describe, expect, it } from "vitest";
import { tryL0OsControlPlan } from "../planner/l0OsControlPlanner.js";

/**
 * W0.3b — "copy X to a new folder called Y" must extract the destination
 * NAME ("Y"), not the raw prose ("a new folder called Y"). The raw phrase
 * used to be handed straight to resolveParentPath, which can't recognize it
 * and silently collapsed the destination to Desktop (wave0 TEST 8).
 */
describe("P8.5-P5.6 W0.3b — copy/move destination phrase extraction", () => {
  it("extracts the folder name from 'a new folder called X'", () => {
    const cmd = "Copy the folder Reports to a new folder called Archive";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.copy_folder");
    expect(result.plan.steps[0]?.args?.destinationFolder).toBe("Archive");
  });

  it("extracts the folder name from 'a folder named X'", () => {
    const cmd = "copy folder Backups to a folder named Old";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args?.destinationFolder).toBe("Old");
  });

  it("leaves a plain destination name untouched", () => {
    const cmd = "copy folder Backups to Documents";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.args?.destinationFolder).toBe("Documents");
  });

  it("applies the same extraction to move_folder", () => {
    const cmd = "move folder Backups to a new folder called Cold Storage";
    const result = tryL0OsControlPlan(cmd, cmd);
    expect(result?.kind).toBe("plan");
    if (result?.kind !== "plan") return;
    expect(result.plan.steps[0]?.tool).toBe("filesystem.move_folder");
    expect(result.plan.steps[0]?.args?.destinationFolder).toBe("Cold Storage");
  });
});
