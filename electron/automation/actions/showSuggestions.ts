import { BrowserWindow } from "electron";
import type { RippleAction } from "../types.js";

export async function runShowSuggestions(
  data?: Record<string, unknown>,
): Promise<string> {
  const items = Array.isArray(data?.items) ? data.items : [];
  const reason = typeof data?.reason === "string" ? data.reason : undefined;

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("actions:suggestions", { reason, items });
    }
  }

  const count = items.length;
  return count > 0
    ? `Showing ${count} suggestion(s)`
    : "Low confidence — try rephrasing your command";
}

export function parseWorkflowSteps(action: RippleAction): RippleAction[] {
  const steps = action.data?.steps;
  if (!Array.isArray(steps)) return [];
  return steps as RippleAction[];
}
