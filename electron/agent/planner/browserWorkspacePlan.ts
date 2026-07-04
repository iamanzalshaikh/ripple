import type { CommandResultPayload } from "../../automation/types.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";
import { resolveTabTargetFromWorkspace } from "../../automation/browser/browserTabResolver.js";
import { findWorkspaceById } from "../../automation/desktop/workspaceRegistry.js";

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Map legacy desktop-fast open_workspace NOOP → browser.open_workspace (never desktop.launch_app). */
export function browserWorkspacePlanFromDesktopPayload(
  payload: CommandResultPayload,
  rawCommand: string,
  normalized: string,
): ExecutionPlan | null {
  const action = payload.actions?.[0];
  if (!action || action.type !== "NOOP") return null;
  const data = (action.data ?? {}) as Record<string, unknown>;
  if (str(data, "desktopKind") !== "open_workspace") return null;

  const workspaceId = str(data, "workspaceId");
  const url = str(data, "workspaceUrl");
  if (!url) return null;

  const workspace = workspaceId ? findWorkspaceById(workspaceId) : undefined;
  const step: PlanStep = {
    tool: "browser.open_workspace",
    args: {
      workspaceId: workspaceId ?? workspace?.id ?? "workspace",
      url,
      tabTarget: workspace
        ? resolveTabTargetFromWorkspace(workspace)
        : { type: "url", url, workspaceId, label: workspaceId },
    },
    reason: "open_workspace",
  };

  return {
    goal: `Open workspace ${workspaceId ?? url}`,
    confidence: 0.88,
    steps: [step],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}
