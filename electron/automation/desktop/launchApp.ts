import { execFile } from "node:child_process";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { hideOverlay } from "../../windows/overlay.js";
import type { NativeAppEntry } from "./nativeAppRegistry.js";
import { resolveLaunchTarget } from "./resolveLaunchTarget.js";
import {
  closeWindowByHwnd,
  focusWindowByHwnd,
  listVisibleWindowsNative,
  sendKeysNative,
} from "../../native/win32Bridge.js";
import { focusAppWindow } from "./windowManager.js";
import { delay } from "../delay.js";

const execFileAsync = promisify(execFile);

async function findNotepadWindow(): Promise<{ hwnd: number; title: string } | null> {
  const windows = await listVisibleWindowsNative();
  const notepad = windows.find(
    (w) => w.hwnd && (w.processName ?? "").toLowerCase() === "notepad",
  );
  if (!notepad?.hwnd) return null;
  return { hwnd: notepad.hwnd, title: notepad.windowTitle ?? "" };
}

function isUntitledNotepad(title: string): boolean {
  return /untitled/i.test((title ?? "").trim());
}

/** Send chords to Notepad HWND — not whatever app stole foreground. */
async function sendKeysToNotepad(
  hwnd: number,
  spec: { keys?: string; delayMs?: number },
): Promise<void> {
  await focusWindowByHwnd(hwnd, "Notepad");
  await delay(250);
  await sendKeysNative({
    hwnd,
    titleHint: "Notepad",
    keys: spec.keys,
    delayMs: spec.delayMs ?? 80,
  });
}

/**
 * Win11 Notepad restores the last tab (e.g. ♦.txt). Close every stale tab,
 * then Ctrl+N so the compound flow always types into a fresh Untitled doc.
 */
async function openFreshNotepadDocument(): Promise<void> {
  if (process.env.OS_TEST_LOCK_WINDOW?.toLowerCase() === "notepad") {
    return;
  }
  for (let round = 0; round < 6; round++) {
    const win = await findNotepadWindow();
    if (!win) return;
    if (isUntitledNotepad(win.title)) break;
    console.info(
      `[ripple-desktop] closing stale notepad tab → "${win.title.slice(0, 40)}"`,
    );
    await sendKeysToNotepad(win.hwnd, { keys: "^w", delayMs: 150 });
    await delay(600);
  }

  const win = await findNotepadWindow();
  if (!win) return;
  await sendKeysToNotepad(win.hwnd, { keys: "^n", delayMs: 120 });
  await delay(700);
  console.info("[ripple-desktop] notepad fresh document → Ctrl+N");
}

async function killNotepad(): Promise<void> {
  try {
    await execFileAsync(
      "taskkill",
      ["/IM", "notepad.exe", "/F", "/T"],
      { windowsHide: true },
    );
  } catch {
    /* no running instance */
  }

  for (let i = 0; i < 8; i++) {
    const alive = (await listVisibleWindowsNative()).some(
      (w) => (w.processName ?? "").toLowerCase() === "notepad",
    );
    if (!alive) break;
    await delay(300);
  }

  const windows = await listVisibleWindowsNative();
  for (const w of windows) {
    if ((w.processName ?? "").toLowerCase() !== "notepad" || !w.hwnd) continue;
    try {
      await closeWindowByHwnd(w.hwnd);
      await delay(200);
    } catch {
      /* continue */
    }
  }

  clearNotepadTabState();
  await delay(400);
  console.info("[ripple-desktop] terminated notepad.exe before launch");
}

/** Win11 session restore — delete TabState while Notepad is closed. */
function clearNotepadTabState(): void {
  const packagesDir = join(homedir(), "AppData", "Local", "Packages");
  if (!existsSync(packagesDir)) return;

  let cleared = 0;
  for (const pkg of readdirSync(packagesDir)) {
    if (!pkg.startsWith("Microsoft.WindowsNotepad_")) continue;
    const tabState = join(packagesDir, pkg, "LocalState", "TabState");
    if (!existsSync(tabState)) continue;
    for (const name of readdirSync(tabState)) {
      try {
        unlinkSync(join(tabState, name));
        cleared++;
      } catch {
        /* locked or gone */
      }
    }
  }
  if (cleared > 0) {
    console.info(`[ripple-desktop] cleared ${cleared} notepad TabState file(s)`);
  }
}

async function startNotepadExe(app: NativeAppEntry): Promise<void> {
  const target = resolveLaunchTarget(app);
  const escaped = target.replace(/'/g, "''");
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${escaped}'`,
    ],
    { windowsHide: true },
  );
}

async function launchNotepadFresh(app: NativeAppEntry): Promise<string> {
  await killNotepad();
  await startNotepadExe(app);
  console.info(`[ripple-desktop] Launched notepad → ${resolveLaunchTarget(app)}`);
  await delay(1500);

  try {
    await focusAppWindow(app);
  } catch {
    /* focus retry after openFresh */
  }

  await openFreshNotepadDocument();

  const after = await findNotepadWindow();
  if (
    after &&
    !isUntitledNotepad(after.title) &&
    process.env.OS_TEST_LOCK_WINDOW?.toLowerCase() !== "notepad"
  ) {
    console.warn(
      `[ripple-desktop] notepad still not untitled ("${after.title.slice(0, 40)}") — hard reset`,
    );
    await killNotepad();
    await startNotepadExe(app);
    await delay(1500);
    await focusAppWindow(app);
    await openFreshNotepadDocument();
  }

  return `Opened ${app.aliases[0] ?? app.id}`;
}

/** Launch a native app by registry entry (exe or URI scheme). */
export async function launchNativeApp(
  app: NativeAppEntry,
  options?: { cwd?: string },
): Promise<string> {
  hideOverlay();

  if (process.platform !== "win32") {
    throw new Error("Native app launch is only supported on Windows");
  }

  if (app.id === "notepad") {
    return launchNotepadFresh(app);
  }

  const target = resolveLaunchTarget(app);
  const escaped = target.replace(/'/g, "''");
  const cwd = options?.cwd?.trim();
  const cwdClause = cwd
    ? ` -WorkingDirectory '${cwd.replace(/'/g, "''")}'`
    : "";

  // Windows Terminal: prefer -d for starting directory.
  if (cwd && (app.id === "windows-terminal" || /\\wt\.exe$/i.test(target))) {
    const dir = cwd.replace(/'/g, "''");
    await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath '${escaped}' -ArgumentList '-d','${dir}'`,
      ],
      { windowsHide: true },
    );
  } else {
    await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath '${escaped}'${cwdClause}`,
      ],
      { windowsHide: true },
    );
  }
  console.info(
    `[ripple-desktop] Launched ${app.id} → ${target}${cwd ? ` cwd=${cwd}` : ""}`,
  );
  await delay(app.id === "file-explorer" ? 900 : 1400);
  try {
    await focusAppWindow(app);
    return `Opened ${app.aliases[0] ?? app.id}`;
  } catch {
    return `Opened ${app.aliases[0] ?? app.id}`;
  }
}
