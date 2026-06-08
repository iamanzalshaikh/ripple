import { clipboard } from "electron";
import {
  getFocusContext,
  isLinkedInWindowTitle,
  restoreFocusContext,
} from "../../../focus/focusContext.js";
import { delay } from "../../delay.js";
import { openUrlInBrowser } from "../../openUrl.js";
import { pasteFromClipboard, sendKeyChord } from "../../keyboard.js";

export const LINKEDIN_HOME = "https://www.linkedin.com/feed/";
export const LINKEDIN_PEOPLE_SEARCH = "https://www.linkedin.com/search/results/people/";

export function shouldUseLinkedInActiveTab(): boolean {
  const ctx = getFocusContext();
  if (!ctx) return false;
  const browser = ["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"];
  if (!browser.includes(ctx.processName.toLowerCase())) return false;
  return isLinkedInWindowTitle(ctx.windowTitle);
}

export async function navigateLinkedInInActiveTab(url: string): Promise<string> {
  await restoreFocusContext();
  await delay(600);
  await sendKeyChord("^l");
  await delay(300);
  clipboard.writeText(url);
  await delay(100);
  await pasteFromClipboard();
  await delay(120);
  await sendKeyChord("{ENTER}");
  await delay(1200);
  return "Navigated in active LinkedIn tab";
}

export async function openLinkedInInBrowser(): Promise<string> {
  if (shouldUseLinkedInActiveTab()) {
    await navigateLinkedInInActiveTab(LINKEDIN_HOME);
    return "Navigated to LinkedIn feed in active tab";
  }
  await openUrlInBrowser(LINKEDIN_HOME);
  return "Opened LinkedIn in browser";
}

export function buildLinkedInPeopleSearchUrl(query: string): string {
  const params = new URLSearchParams();
  params.set("keywords", query.trim());
  return `${LINKEDIN_PEOPLE_SEARCH}?${params.toString()}`;
}

export async function searchLinkedInPeople(query: string): Promise<string> {
  const q = query.trim();
  if (!q) throw new Error("LinkedIn people search query is empty");
  const url = buildLinkedInPeopleSearchUrl(q);
  if (shouldUseLinkedInActiveTab()) {
    await navigateLinkedInInActiveTab(url);
    return `LinkedIn people search in active tab — ${q.slice(0, 80)}`;
  }
  await openUrlInBrowser(url);
  return `LinkedIn people search opened — ${q.slice(0, 80)}`;
}
