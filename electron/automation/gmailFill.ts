import { clipboard } from "electron";
import { restoreFocusContext } from "../focus/focusContext.js";
import { delay } from "./delay.js";
import type { ParsedEmail } from "./emailParse.js";
import {
  pasteFromClipboard,
  selectAll,
  sendShiftTab,
  sendTab,
} from "./keyboard.js";

async function fillField(value: string): Promise<void> {
  clipboard.writeText(value);
  await delay(100);
  await selectAll();
  await delay(50);
  await pasteFromClipboard();
  await delay(120);
}

/**
 * Keyboard fallback — navigate To → Subject → Body.
 * From Subject: Shift+Tab×1. From Body: Shift+Tab×2.
 */
export async function fillGmailComposeKeyboard(
  parsed: ParsedEmail,
  startField: "to" | "subject" | "body" = "body",
): Promise<string> {
  await restoreFocusContext();
  await delay(450);

  const backTabs = startField === "subject" ? 1 : startField === "body" ? 2 : 0;
  if (backTabs > 0) {
    await sendShiftTab(backTabs);
  }

  const parts: string[] = [];

  if (parsed.to) {
    await fillField(parsed.to);
    parts.push("To");
    await sendTab();
  } else if (parsed.subject || parsed.body) {
    await sendTab();
  }

  if (parsed.subject) {
    await fillField(parsed.subject);
    parts.push("Subject");
    await sendTab();
  } else if (parsed.body) {
    await sendTab();
  }

  if (parsed.body) {
    await fillField(parsed.body);
    parts.push("Body");
  }

  if (parts.length === 0) {
    throw new Error("Nothing to fill in Gmail compose");
  }

  return `Gmail filled: ${parts.join(", ")}`;
}
