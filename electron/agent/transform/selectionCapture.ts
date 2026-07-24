import { clipboard } from "electron";
import { restoreFocusContext } from "../../focus/focusContext.js";
import { delay } from "../../automation/delay.js";
import { sendKeyChord } from "../../automation/keyboard.js";

const SENTINEL_RE = /^__ripple_no_selection_\d+__$/;

/**
 * P8.1 — read the currently highlighted selection in the focused app (no
 * select-all, unlike readFocusedField.ts). Uses a sentinel clipboard value
 * to reliably tell "nothing selected" (Ctrl+C is a no-op, clipboard keeps
 * the sentinel) apart from "selection copied" (clipboard now holds it).
 */
export async function readSelectedText(): Promise<string | null> {
  const saved = clipboard.readText();
  const sentinel = `__ripple_no_selection_${Date.now()}__`;
  try {
    await restoreFocusContext();
    await delay(150);
    clipboard.writeText(sentinel);
    await sendKeyChord("^c");
    await delay(180);
    const copied = clipboard.readText();
    if (!copied || copied === sentinel || SENTINEL_RE.test(copied.trim())) {
      return null;
    }
    const trimmed = copied.trim();
    return trimmed.length >= 1 ? trimmed : null;
  } catch {
    return null;
  } finally {
    // Always restore — never leave the sentinel on the user's clipboard.
    try {
      clipboard.writeText(saved);
    } catch {
      /* ignore */
    }
  }
}
