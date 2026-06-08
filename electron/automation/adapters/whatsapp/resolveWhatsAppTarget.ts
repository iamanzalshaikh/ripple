import { delay } from "../../delay.js";
import {
  getFocusContext,
  setFocusContext,
  type FocusContext,
} from "../../../focus/focusContext.js";
import {
  findChromeMainWindow,
  findWhatsAppBrowserWindow,
  isRippleOrEditorWindow,
} from "../../../focus/findWhatsAppWindow.js";
import { getLastVoiceCommand } from "../../../state/lastCommand.js";
import { isWhatsAppMessagingCommand } from "./parseContact.js";
import {
  focusWhatsAppTabInChrome,
  openWhatsAppNewTabInChrome,
} from "./openWhatsAppTab.js";

function commandWantsWhatsApp(command?: string | null): boolean {
  const cmd = command ?? getLastVoiceCommand() ?? "";
  return isWhatsAppMessagingCommand(cmd) || /\bwhatsapp\b/i.test(cmd);
}

/**
 * Resolve Chrome + WhatsApp for automation (title match, Chrome fallback, tab focus).
 */
export async function resolveWhatsAppChromeTarget(
  command?: string | null,
): Promise<FocusContext | null> {
  let ctx = getFocusContext();
  if (ctx?.hwnd && ctx.isWhatsApp && !isRippleOrEditorWindow(ctx)) {
    return ctx;
  }

  let found = await findWhatsAppBrowserWindow();
  if (found?.hwnd) {
    setFocusContext(found);
    return found;
  }

  const chrome = await findChromeMainWindow();
  if (!chrome?.hwnd) {
    console.warn("[ripple-desktop] No Chrome window visible for WhatsApp");
    return null;
  }

  if (commandWantsWhatsApp(command)) {
    console.info(
      "[ripple-desktop] WhatsApp tab not active — focusing via Chrome tab search",
    );
    await focusWhatsAppTabInChrome(chrome.hwnd, chrome.windowTitle);
    await delay(500);
    found = await findWhatsAppBrowserWindow();
    if (!found?.hwnd) {
      await openWhatsAppNewTabInChrome(chrome.hwnd, chrome.windowTitle);
      found = await findWhatsAppBrowserWindow();
    }
    if (found?.hwnd) {
      setFocusContext(found);
      return found;
    }
    const ready: FocusContext = {
      ...chrome,
      isWhatsApp: true,
      capturedAt: Date.now(),
    };
    setFocusContext(ready);
    return ready;
  }

  return null;
}
