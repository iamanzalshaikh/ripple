import { Menu, Tray, nativeImage } from "electron";
import { showMainWindow } from "../windows/mainWindow.js";
import { handleShortcutPress } from "../windows/overlay.js";

let tray: Tray | null = null;

function buildTrayIcon(): Electron.NativeImage {
  // 16x16 purple dot — no asset file required for MVP
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const inside = cx * cx + cy * cy <= (size / 2 - 1) ** 2;
      if (inside) {
        canvas[i] = 99;
        canvas[i + 1] = 102;
        canvas[i + 2] = 241;
        canvas[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

export function createTray(onQuit: () => void): Tray {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip("Ripple");

  const menu = Menu.buildFromTemplate([
    { label: "Open Ripple", click: () => showMainWindow() },
    { label: "Voice (Ctrl+Space)", click: () => handleShortcutPress() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => onQuit(),
    },
  ]);

  tray.setContextMenu(menu);
  tray.on("double-click", () => showMainWindow());

  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
