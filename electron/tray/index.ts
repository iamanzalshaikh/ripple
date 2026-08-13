import { Menu, Tray, nativeImage } from "electron";
import { showMainWindow } from "../windows/mainWindow.js";
import {
  handleShortcutPress,
  handleMeetingShortcutPress,
} from "../windows/overlay.js";

let tray: Tray | null = null;
let meetingRecording = false;

function buildTrayIcon(recording: boolean): Electron.NativeImage {
  // 16x16 purple (idle) or rose (meeting) dot — no asset file required.
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const r = recording ? 244 : 99;
  const g = recording ? 63 : 102;
  const b = recording ? 94 : 241;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const inside = cx * cx + cy * cy <= (size / 2 - 1) ** 2;
      if (inside) {
        canvas[i] = r;
        canvas[i + 1] = g;
        canvas[i + 2] = b;
        canvas[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function rebuildMenu(onQuit: () => void): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: "Open Ripple", click: () => showMainWindow() },
    { label: "Voice (Ctrl+Space)", click: () => void handleShortcutPress() },
    { type: "separator" },
    meetingRecording
      ? {
          label: "Stop Meeting Recording",
          click: () => void handleMeetingShortcutPress(),
        }
      : {
          label: "Start Meeting (Ctrl+Shift+M)",
          click: () => void handleMeetingShortcutPress(),
        },
    { type: "separator" },
    {
      label: "Quit",
      click: () => onQuit(),
    },
  ]);
  tray.setContextMenu(menu);
}

let quitHandler: (() => void) | null = null;

export function createTray(onQuit: () => void): Tray {
  quitHandler = onQuit;
  tray = new Tray(buildTrayIcon(false));
  tray.setToolTip("Ripple");
  rebuildMenu(onQuit);
  tray.on("double-click", () => showMainWindow());
  return tray;
}

/** P10.2 — red tray icon + Stop Meeting while a meeting is recording. */
export function setMeetingRecordingTray(active: boolean): void {
  meetingRecording = active;
  if (!tray) return;
  tray.setImage(buildTrayIcon(active));
  tray.setToolTip(active ? "Ripple — Meeting recording" : "Ripple");
  if (quitHandler) rebuildMenu(quitHandler);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
  quitHandler = null;
  meetingRecording = false;
}
