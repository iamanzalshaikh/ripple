import { clipboard } from "electron";
import {
  getFocusContext,
  restoreFocusContext,
} from "../../focus/focusContext.js";
import { delay } from "../delay.js";
import { openUrlInBrowser } from "../openUrl.js";
import { pasteFromClipboard, sendKeyChord } from "../keyboard.js";
import type { WorkspaceEntry } from "../desktop/workspaceRegistry.js";

const BROWSER_PROCESSES = new Set([
  "chrome",
  "msedge",
  "firefox",
  "brave",
  "opera",
  "vivaldi",
  "chromium",
]);

export type TabTarget = {
  type: "url";
  url: string;
  workspaceId?: string;
  label?: string;
};

export function isBrowserProcess(processName: string): boolean {
  return BROWSER_PROCESSES.has(processName.toLowerCase());
}

/** True when a supported browser window is the captured focus target. */
export function shouldNavigateInActiveBrowser(): boolean {
  const ctx = getFocusContext();
  if (!ctx) return false;
  return isBrowserProcess(ctx.processName);
}

export function resolveTabTargetFromWorkspace(
  workspace: WorkspaceEntry,
): TabTarget {
  return {
    type: "url",
    url: workspace.url,
    workspaceId: workspace.id,
    label: workspace.id,
  };
}

export function describeActiveBrowserTarget(): string | null {
  const ctx = getFocusContext();
  if (!ctx || !isBrowserProcess(ctx.processName)) return null;
  const tab =
    ctx.activeTabUrl?.trim() ||
    ctx.windowTitle?.trim() ||
    ctx.processName;
  return `${ctx.processName} → ${tab.slice(0, 80)}`;
}

/** Navigate the focused browser tab via the address bar (no new window). */
export async function navigateActiveBrowserTab(url: string): Promise<string> {
  const normalized = url.trim();
  if (!normalized) throw new Error("URL missing");

  await restoreFocusContext();
  await delay(600);
  await sendKeyChord("^l");
  await delay(300);
  clipboard.writeText(normalized);
  await delay(100);
  await pasteFromClipboard();
  await delay(150);
  await sendKeyChord("{ENTER}");
  await delay(800);
  return `Navigated active tab → ${normalized}`;
}

/**
 * Open a URL in the active browser tab when a browser is focused,
 * otherwise launch via the default browser.
 */
export async function openUrlWithTabResolver(
  url: string,
  opts?: { workspaceId?: string; preferActiveTab?: boolean },
): Promise<string> {
  const normalized = url.trim();
  if (!normalized) throw new Error("URL missing");

  const inBrowser =
    opts?.preferActiveTab !== false && shouldNavigateInActiveBrowser();
  const label = opts?.workspaceId
    ? `${opts.workspaceId} (${normalized})`
    : normalized;

  const active = describeActiveBrowserTarget();
  console.info(
    `[ripple-p85] browser tab target: mode=${inBrowser ? "active_tab" : "new_window"} url=${label.slice(0, 80)}${active ? ` focus=${active}` : ""}`,
  );

  if (inBrowser) {
    return navigateActiveBrowserTab(normalized);
  }
  await openUrlInBrowser(normalized);
  return `Opened ${label.slice(0, 80)}`;
}
