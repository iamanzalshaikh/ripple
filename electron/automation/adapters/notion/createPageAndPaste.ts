import { clipboard } from "electron";
import { getFocusContext } from "../../../focus/focusContext.js";
import { readClipboardText } from "../../clipboard/clipboardService.js";
import { delay } from "../../delay.js";
import {
  pasteFromClipboard,
  selectAll,
  sendKeyChord,
  simulateTyping,
} from "../../keyboard.js";
import { openNotionNewPage, shouldNavigateNotionInActiveTab } from "./openNotion.js";

const TYPING_MAX = 400;
const EDITOR_WAIT_IN_TAB_MS = [3500, 2500, 2000];
const EDITOR_WAIT_NEW_TAB_MS = [6000, 4000, 3000];

export interface CreateNotionPageOptions {
  pasteClipboard: boolean;
  title?: string;
  body?: string;
}

async function waitForNotionEditor(inActiveNotionTab: boolean): Promise<void> {
  const waits = inActiveNotionTab ? EDITOR_WAIT_IN_TAB_MS : EDITOR_WAIT_NEW_TAB_MS;
  for (const ms of waits) {
    await delay(ms);
  }
}

function resolveBody(options: CreateNotionPageOptions): string {
  const fromVoice = options.body?.trim() ?? "";
  if (fromVoice) return fromVoice;

  if (options.pasteClipboard) {
    const clip = readClipboardText();
    if (!clip) {
      throw new Error(
        "Clipboard is empty — copy your documentation first (Ctrl+C), then say paste my clipboard",
      );
    }
    console.info(`[ripple-desktop] Notion body from clipboard (${clip.length} chars)`);
    return clip;
  }

  return "";
}

async function insertBody(text: string): Promise<void> {
  if (text.length <= TYPING_MAX) {
    try {
      await simulateTyping(text);
      return;
    } catch {
      /* fall through to paste */
    }
  }
  clipboard.writeText(text);
  await delay(150);
  await selectAll();
  await delay(60);
  await pasteFromClipboard();
}

/**
 * New page via notion.new — not Ctrl+N (new window).
 * Uses in-tab navigation only on a real Notion tab; otherwise opens notion.new in a new tab.
 */
export async function createNotionPageAndPaste(
  options: CreateNotionPageOptions,
  _alreadyOnNotion: boolean,
): Promise<string> {
  const inActiveNotionTab = shouldNavigateNotionInActiveTab();
  const bodyText = resolveBody(options);

  console.info(
    `[ripple-desktop] Notion — notion.new (${inActiveNotionTab ? "active Notion tab" : "new browser tab"})`,
  );
  const openMsg = await openNotionNewPage(inActiveNotionTab);
  await waitForNotionEditor(inActiveNotionTab);

  const parts: string[] = [openMsg];

  if (options.title?.trim()) {
    await typeNotionTitle(options.title.trim());
    parts.push(`title: ${options.title.trim().slice(0, 40)}`);
    await delay(600);
  }

  if (bodyText) {
    await delay(500);
    await insertBody(bodyText);
    parts.push(`body: ${bodyText.length} chars`);
  } else if (!options.title) {
    parts.push("(empty — copy text, then say paste my clipboard)");
  }

  return parts.join(" · ");
}

/** Title field on a new page — type then Enter to move to body. Do not restore stale hwnd. */
export async function typeNotionTitle(title: string): Promise<void> {
  const t = title.trim();
  if (!t || t.length > 120) return;
  await delay(300);
  await simulateTyping(t);
  await sendKeyChord("{ENTER}");
  await delay(500);
}

/** Hint when Notion tab did not get focus. */
export function assertNotionReachable(): void {
  const ctx = getFocusContext();
  const t = ctx?.windowTitle ?? "";
  if (ctx && !shouldNavigateNotionInActiveTab()) {
    console.warn(
      "[ripple-desktop] Notion — focus a Notion tab in Chrome first, or log in at notion.so; using new tab for notion.new",
    );
  }
}
