import { execFile } from "node:child_process";
import { shell } from "electron";
import { promisify } from "node:util";
import { hideOverlay } from "../../windows/overlay.js";

const execFileAsync = promisify(execFile);

export type SystemActionId =
  | "lock_pc"
  | "open_settings"
  | "open_control_panel"
  | "open_bluetooth_settings"
  | "open_network_settings";

const ACTION_LABELS: Record<SystemActionId, string> = {
  lock_pc: "Locked your PC",
  open_settings: "Opened Settings",
  open_control_panel: "Opened Control Panel",
  open_bluetooth_settings: "Opened Bluetooth settings",
  open_network_settings: "Opened Network settings",
};

function requireWindows(): void {
  if (process.platform !== "win32") {
    throw new Error("System actions are only supported on Windows");
  }
}

async function openSettingsUri(uri: string): Promise<void> {
  await shell.openExternal(uri);
}

/** Run a Windows system action by voice intent id. */
export async function runSystemAction(action: SystemActionId): Promise<string> {
  hideOverlay();
  requireWindows();

  switch (action) {
    case "lock_pc":
      await execFileAsync(
        "rundll32.exe",
        ["user32.dll,LockWorkStation"],
        { windowsHide: true },
      );
      break;
    case "open_settings":
      await openSettingsUri("ms-settings:");
      break;
    case "open_control_panel":
      await execFileAsync("control.exe", [], { windowsHide: true });
      break;
    case "open_bluetooth_settings":
      await openSettingsUri("ms-settings:bluetooth");
      break;
    case "open_network_settings":
      await openSettingsUri("ms-settings:network");
      break;
    default:
      throw new Error(`Unknown system action: ${String(action)}`);
  }

  console.info(`[ripple-desktop] System action: ${action}`);
  return ACTION_LABELS[action];
}
