import { clipboard } from "electron";
import {
  getFocusContext,
  isYouTubeWindowTitle,
  restoreFocusContext,
} from "../../../focus/focusContext.js";
import { delay } from "../../delay.js";
import { pasteFromClipboard, sendKeyChord, simulateTyping } from "../../keyboard.js";
import { openUrlInBrowser } from "../../openUrl.js";

export const YOUTUBE_HOME = "https://www.youtube.com/";
export const YOUTUBE_SEARCH_BASE = "https://www.youtube.com/results";

export function buildYouTubeSearchUrl(query: string): string {
  const params = new URLSearchParams();
  params.set("search_query", query.trim());
  return `${YOUTUBE_SEARCH_BASE}?${params.toString()}`;
}

/** True when captured focus is a YouTube tab in a supported browser. */
export function shouldSearchYouTubeInActiveTab(): boolean {
  const ctx = getFocusContext();
  if (!ctx) return false;
  const browser = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];
  if (!browser.includes(ctx.processName.toLowerCase())) return false;
  return isYouTubeWindowTitle(ctx.windowTitle);
}

/** Navigate the active browser tab to search results (no new Chrome window). */
export async function searchYouTubeInActiveTab(query: string): Promise<string> {
  const url = buildYouTubeSearchUrl(query);
  await restoreFocusContext();
  await delay(600);
  await sendKeyChord("^l");
  await delay(300);
  clipboard.writeText(url);
  await delay(100);
  await pasteFromClipboard();
  await delay(150);
  await sendKeyChord("{ENTER}");
  await delay(1200);
  return `YouTube search in active tab — ${query.slice(0, 80)}`;
}

/**
 * YouTube in-page search via "/" shortcut (when already on youtube.com).
 * Fallback if URL bar navigation fails in some layouts.
 */
export async function searchYouTubeWithShortcut(query: string): Promise<string> {
  const q = query.trim();
  await restoreFocusContext();
  await delay(500);
  await sendKeyChord("/");
  await delay(400);
  await selectAllAndType(q);
  await sendKeyChord("{ENTER}");
  await delay(800);
  return `YouTube search (in-page) — ${q.slice(0, 80)}`;
}

async function selectAllAndType(text: string): Promise<void> {
  await sendKeyChord("^a");
  await delay(80);
  if (text.length <= 120) {
    await simulateTyping(text);
  } else {
    clipboard.writeText(text);
    await delay(80);
    await pasteFromClipboard();
  }
}

/** Open YouTube search — active tab when on YouTube, else new browser tab. */
export async function searchYouTube(query: string): Promise<string> {
  const q = query.trim();
  if (!q) throw new Error("YouTube search query is empty");

  const url = buildYouTubeSearchUrl(q);
  console.info(
    `[ripple-desktop] YouTube search — q="${q.slice(0, 80)}" (${shouldSearchYouTubeInActiveTab() ? "active tab" : "new tab"})`,
  );

  if (shouldSearchYouTubeInActiveTab()) {
    return searchYouTubeInActiveTab(q);
  }

  await openUrlInBrowser(url);
  return `YouTube search opened — ${q.slice(0, 80)}`;
}
