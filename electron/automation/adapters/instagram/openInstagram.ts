import { clipboard } from "electron";
import {
  getFocusContext,
  isInstagramWindowTitle,
  restoreFocusContext,
} from "../../../focus/focusContext.js";
import { delay } from "../../delay.js";
import { openUrlInBrowser } from "../../openUrl.js";
import { pasteFromClipboard, sendKeyChord } from "../../keyboard.js";

export const INSTAGRAM_HOME = "https://www.instagram.com/";
export const INSTAGRAM_INBOX = "https://www.instagram.com/direct/inbox/";

export function shouldUseInstagramActiveTab(): boolean {
  const ctx = getFocusContext();
  if (!ctx) return false;
  const browser = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];
  if (!browser.includes(ctx.processName.toLowerCase())) return false;
  return isInstagramWindowTitle(ctx.windowTitle);
}

export async function openInstagramInBrowser(): Promise<string> {
  if (shouldUseInstagramActiveTab()) {
    await restoreFocusContext();
    await delay(600);
    await sendKeyChord("^l");
    await delay(300);
    clipboard.writeText(INSTAGRAM_HOME);
    await delay(100);
    await pasteFromClipboard();
    await delay(120);
    await sendKeyChord("{ENTER}");
    await delay(1200);
    return "Navigated to Instagram in active tab";
  }
  await openUrlInBrowser(INSTAGRAM_HOME);
  return "Opened Instagram in browser";
}
