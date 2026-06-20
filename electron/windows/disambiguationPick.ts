import { BrowserWindow, ipcMain } from "electron";
import {
  expandOverlayForDisambiguation,
  resetOverlaySize,
  sendToOverlay,
  showOverlay,
} from "./overlay.js";

export type DisambiguationItem = {
  path: string;
  label: string;
};

let pending:
  | {
      resolve: (path: string | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  | null = null;

function broadcastPickRequest(
  spoken: string,
  items: DisambiguationItem[],
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("disambiguation:show", { spoken, items });
    }
  }
  sendToOverlay("disambiguation:show", { spoken, items });
}

export function registerDisambiguationPickIpc(): void {
  ipcMain.handle(
    "disambiguation:pick",
    (_e, args: { path?: string | null }) => {
      const path = typeof args?.path === "string" ? args.path : null;
      if (!pending) return { ok: false };
      clearTimeout(pending.timer);
      pending.resolve(path);
      pending = null;
      sendToOverlay("disambiguation:hide", {});
      resetOverlaySize();
      return { ok: true };
    },
  );
}

/** Wait for overlay/renderer pick; resolves null on timeout. */
export function waitForOverlayPick(
  spoken: string,
  items: DisambiguationItem[],
  timeoutMs = 45_000,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(null);
    }

    const timer = setTimeout(() => {
      pending = null;
      sendToOverlay("disambiguation:hide", {});
      resetOverlaySize();
      resolve(null);
    }, timeoutMs);

    pending = { resolve, timer };
    showOverlay();
    expandOverlayForDisambiguation(items.length);
    broadcastPickRequest(spoken, items);
  });
}

export function cancelPendingDisambiguationPick(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.resolve(null);
  pending = null;
  sendToOverlay("disambiguation:hide", {});
  resetOverlaySize();
}
