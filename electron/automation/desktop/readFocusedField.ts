import { clipboard } from "electron";
import { restoreFocusContext } from "../../focus/focusContext.js";
import { delay } from "../delay.js";
import { selectAll, sendKeyChord } from "../keyboard.js";

/** Copy all text from the focused field (Gmail compose, etc.). */
export async function readFocusedFieldText(): Promise<string | null> {
  try {
    await restoreFocusContext();
    await delay(450);
    const saved = clipboard.readText();
    await selectAll();
    await delay(80);
    await sendKeyChord("^c");
    await delay(200);
    const text = clipboard.readText().trim();
    clipboard.writeText(saved);
    return text.length >= 2 ? text : null;
  } catch {
    return null;
  }
}
