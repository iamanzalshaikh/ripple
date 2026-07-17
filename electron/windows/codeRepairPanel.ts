import { BrowserWindow, ipcMain } from "electron";
import {
  expandOverlayForCodeRepair,
  hideOverlay,
  resetOverlaySize,
  sendToOverlay,
  showOverlay,
} from "./overlay.js";
import type { CodeRepairPanelPayload } from "../automation/shell/codeRepairReveal.js";
import {
  openFileAtLineInIde,
  resolveIdeApp,
} from "../automation/shell/projectResolver.js";
import { clearPendingCodeRepair } from "../agent/planner/codeRepairSession.js";

export type CodeRepairPanelAction = "open" | "apply" | "ignore";

type PanelState = {
  payload: CodeRepairPanelPayload;
};

let active: PanelState | null = null;
let applyHandler: ((payload: CodeRepairPanelPayload) => Promise<void>) | null =
  null;

function broadcastRepairPanel(
  channel: "code-repair:show" | "code-repair:hide",
  payload?: CodeRepairPanelPayload,
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload ?? {});
    }
  }
  sendToOverlay(channel, payload ?? {});
}

export function setCodeRepairApplyHandler(
  handler: (payload: CodeRepairPanelPayload) => Promise<void>,
): void {
  applyHandler = handler;
}

/** Show the visible fix panel on the overlay (does not steal IDE focus). */
export function showCodeRepairPanel(payload: CodeRepairPanelPayload): void {
  active = { payload };
  showOverlay();
  expandOverlayForCodeRepair();
  broadcastRepairPanel("code-repair:show", payload);
  console.info(
    `[ripple-p85] code_repair panel: ${payload.fileName}:${payload.line} ${payload.code}`,
  );
}

export function hideCodeRepairPanel(): void {
  active = null;
  broadcastRepairPanel("code-repair:hide");
  resetOverlaySize();
  hideOverlay();
}

export function registerCodeRepairPanelIpc(): void {
  ipcMain.handle(
    "code-repair:action",
    async (_e, args: { action?: string }) => {
      const action = (args?.action ?? "").toLowerCase() as CodeRepairPanelAction;
      const panel = active;
      if (!panel) return { ok: false, error: "no_active_panel" };

      if (action === "ignore") {
        clearPendingCodeRepair();
        hideCodeRepairPanel();
        return { ok: true };
      }

      if (action === "open") {
        const ide = resolveIdeApp();
        if (!ide) return { ok: false, error: "ide_not_found" };
        try {
          await openFileAtLineInIde(
            panel.payload.file,
            panel.payload.line,
            ide,
          );
          return { ok: true };
        } catch (e: unknown) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : "open_failed",
          };
        }
      }

      if (action === "apply") {
        hideCodeRepairPanel();
        if (applyHandler) {
          try {
            await applyHandler(panel.payload);
            return { ok: true };
          } catch (e: unknown) {
            return {
              ok: false,
              error: e instanceof Error ? e.message : "apply_failed",
            };
          }
        }
        return { ok: false, error: "no_apply_handler" };
      }

      return { ok: false, error: "unknown_action" };
    },
  );
}
