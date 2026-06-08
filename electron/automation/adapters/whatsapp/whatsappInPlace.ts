import { clipboard } from "electron";
import { getFocusContext } from "../../../focus/focusContext.js";
import { resolveWhatsAppChromeTarget } from "./resolveWhatsAppTarget.js";
import { delay } from "../../delay.js";
import { runWhatsAppKeysOnWindow } from "../../keyboardToWindow.js";

async function resolveTarget(): Promise<{ hwnd: number; title: string }> {
  const ctx = getFocusContext();
  if (ctx?.hwnd) {
    return { hwnd: ctx.hwnd, title: ctx.windowTitle };
  }

  const found = await resolveWhatsAppChromeTarget();
  if (found?.hwnd) {
    return { hwnd: found.hwnd, title: found.windowTitle };
  }

  return { hwnd: 0, title: "" };
}

/**
 * Automate WhatsApp in your normal Chrome via focus + mouse + keys.
 */
export async function runWhatsAppInFocusedWindow(args: {
  contact: string;
  message: string;
  send: boolean;
}): Promise<string> {
  const { hwnd, title } = await resolveTarget();
  if (!hwnd) {
    throw new Error(
      "WhatsApp window not found. Open https://web.whatsapp.com in Chrome first.",
    );
  }

  console.info(
    `[ripple-desktop] WhatsApp in-place hwnd=${hwnd} contact="${args.contact}"`,
  );

  await runWhatsAppKeysOnWindow(
    hwnd,
    title,
    args.contact,
    args.message,
    args.send,
  );

  throw new Error(
    "Keyboard fallback finished without DOM verification — set CDP on Chrome (--remote-debugging-port=9222) for real automation",
  );
}
