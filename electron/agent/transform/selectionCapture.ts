import { clipboard } from "electron";
import {
  restoreFocusContext,
  resolveTypingFocusTarget,
  isDesktopShellForeground,
} from "../../focus/focusContext.js";
import { delay } from "../../automation/delay.js";
import { selectAll, sendKeyChord } from "../../automation/keyboard.js";
import {
  getFocusedA11yElement,
  getForegroundWindow,
} from "../../native/win32Bridge.js";
import { ensureBrowserComposerFocus, isBrowserProcess } from "../editorFocus.js";

const SENTINEL_RE = /^__ripple_no_selection_\d+__$/;

function isEditLikeControl(controlType?: string): boolean {
  const c = (controlType ?? "").toLowerCase();
  return (
    c.includes("edit") ||
    c.includes("document") ||
    c.includes("text") ||
    c.includes("code")
  );
}

function looksLikeSentinel(text: string): boolean {
  return !text || text === "" || SENTINEL_RE.test(text.trim());
}

/**
 * P8.1 — read the currently highlighted selection in the focused app (no
 * select-all, unlike readFocusedField.ts). Uses a sentinel clipboard value
 * to reliably tell "nothing selected" (Ctrl+C is a no-op, clipboard keeps
 * the sentinel) apart from "selection copied" (clipboard now holds it).
 *
 * WhatsApp composer: after dictation the draft is often unselected. If a
 * plain Ctrl+C misses, capture the whole composer (Ctrl+A, Ctrl+C) so F9
 * can rewrite the unsent draft instead of reporting NO TEXT SELECTED.
 */
export async function readSelectedText(): Promise<string | null> {
  const saved = clipboard.readText();
  const sentinel = `__ripple_no_selection_${Date.now()}__`;
  try {
    const restored = await restoreFocusContext();
    if (restored === false) {
      // Stale pin (last dictation was Chrome) must not abort when the user
      // highlighted text in the window that actually has FG (Cursor, Notepad).
      // Explorer / empty FG still skip — Ctrl+C there copies nothing useful.
      const fg = await getForegroundWindow();
      const proc = (fg?.processName ?? "").toLowerCase();
      const title = fg?.windowTitle ?? "";
      const unusable =
        !fg?.hwnd ||
        isDesktopShellForeground({
          processName: fg.processName,
          windowTitle: title,
        }) ||
        (proc === "electron" && /ripple/i.test(title));
      if (unusable) {
        console.warn(
          "[ripple-desktop] Transforms capture skipped — could not restore target window",
        );
        return null;
      }
      console.info(
        `[ripple-desktop] Transforms capture using live FG ${proc} — pin restore missed`,
      );
    }
    await delay(150);
    clipboard.writeText(sentinel);
    await sendKeyChord("^c");
    await delay(180);
    let copied = clipboard.readText();
    if (!looksLikeSentinel(copied) && copied !== sentinel) {
      const trimmed = copied.trim();
      return trimmed.length >= 1 ? trimmed : null;
    }

    const target = resolveTypingFocusTarget();
    const browser =
      target?.isBrowser === true ||
      target?.isWhatsApp === true ||
      isBrowserProcess(target?.processName ?? "");
    if (!browser) return null;

    await ensureBrowserComposerFocus();
    const a11y = await getFocusedA11yElement();
    if (!isEditLikeControl(a11y?.controlType)) {
      return null;
    }
    await selectAll();
    await delay(80);
    clipboard.writeText(sentinel);
    await sendKeyChord("^c");
    await delay(180);
    copied = clipboard.readText();
    if (!copied || copied === sentinel || SENTINEL_RE.test(copied.trim())) {
      return null;
    }
    const trimmed = copied.trim();
    console.info(
      `[ripple-desktop] Transforms captured composer draft (${trimmed.length} chars) after empty selection`,
    );
    return trimmed.length >= 1 ? trimmed : null;
  } catch {
    return null;
  } finally {
    try {
      clipboard.writeText(saved);
    } catch {
      /* ignore */
    }
  }
}
