import { clipboard } from "electron";
import {
  getFocusContext,
  isNotionWindowTitle,
  restoreFocusContext,
} from "../../../focus/focusContext.js";
import { delay } from "../../delay.js";
import {
  pasteFromClipboard,
  sendKeyChord,
  simulateTyping,
} from "../../keyboard.js";
import { openUrlInBrowser } from "../../openUrl.js";

export const NOTION_HOME = "https://www.notion.so/";
/** Opens a new page in the browser tab (not Ctrl+N — that spawns a new Notion window). */
export const NOTION_NEW_PAGE = "https://www.notion.new/";

export async function openNotionInBrowser(): Promise<string> {
  await openUrlInBrowser(NOTION_HOME);
  return "Opened Notion in browser";
}

/** True when captured focus is a real Notion browser tab. */
export function shouldNavigateNotionInActiveTab(): boolean {
  const ctx = getFocusContext();
  if (!ctx) return false;
  const browser = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];
  if (!browser.includes(ctx.processName.toLowerCase())) return false;
  return isNotionWindowTitle(ctx.windowTitle);
}

/** Navigate the active browser tab to notion.new (only when already on Notion). */
export async function openNotionNewPageInActiveTab(): Promise<string> {
  await restoreFocusContext();
  await delay(600);
  await sendKeyChord("^l");
  await delay(300);
  clipboard.writeText(NOTION_NEW_PAGE);
  await delay(100);
  await pasteFromClipboard();
  await delay(150);
  await sendKeyChord("{ENTER}");
  await delay(800);
  return "Navigated to notion.new in active tab";
}

export async function openNotionNewPage(useActiveTab: boolean): Promise<string> {
  if (useActiveTab && shouldNavigateNotionInActiveTab()) {
    return openNotionNewPageInActiveTab();
  }
  console.info(
    "[ripple-desktop] Notion — opening notion.new in new browser tab (log in at notion.so if prompted)",
  );
  await openUrlInBrowser(NOTION_NEW_PAGE);
  await delay(5500);
  return "Opened notion.new in browser";
}

/**
 * Quick Find (Ctrl+P) → type workspace name → Enter.
 * User must be logged in; works in Notion web.
 */
export async function focusNotionWorkspace(name: string): Promise<string> {
  const q = name.trim().slice(0, 80);
  if (!q) return "No workspace name";

  if (shouldNavigateNotionInActiveTab()) {
    await restoreFocusContext();
    await delay(800);
  }

  await sendKeyChord("^p");
  await delay(500);
  await simulateTyping(q);
  await delay(900);
  await sendKeyChord("{ENTER}");
  await delay(1200);

  return `Notion workspace: ${q}`;
}
