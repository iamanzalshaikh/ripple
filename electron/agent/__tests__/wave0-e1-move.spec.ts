import { describe, expect, it } from "vitest";
import { tryL0OsControlPlan } from "../planner/l0OsControlPlanner.js";
import { validatePlan } from "../planner/planValidator.js";
import { ensureP85ToolsRegistered } from "../planner/toolExecutorBridge.js";
import { permissionForCommand } from "../../automation/safety/permissionEngine.js";

describe("Wave0 E1 move absolute under C:\\Ripple-Test", () => {
  it("does not block move of C:\\Ripple-Test paths as system paths", () => {
    const cmd =
      "Move the folder C:\\Ripple-Test\\W0\\Source\\TestFolder to a new folder called Moved";
    expect(permissionForCommand(cmd).level).not.toBe("blocked");
  });

  it("still blocks moves into Windows\\System32", () => {
    expect(
      permissionForCommand("move folder notes to C:\\Windows\\System32").level,
    ).toBe("blocked");
  });

  it("plans and validates move_folder for Ripple-Test absolute path", () => {
    ensureP85ToolsRegistered();
    const cmd =
      "Move the folder C:\\Ripple-Test\\W0\\Source\\TestFolder to a new folder called Moved";
    const l0 = tryL0OsControlPlan(cmd, cmd);
    expect(l0?.kind).toBe("plan");
    if (l0?.kind !== "plan") return;
    expect(l0.plan.steps[0]?.tool).toBe("filesystem.move_folder");
    const v = validatePlan(
      l0.plan,
      { clipboard: { hasText: false } } as never,
      cmd,
    );
    expect(v.valid).toBe(true);
  });
});
