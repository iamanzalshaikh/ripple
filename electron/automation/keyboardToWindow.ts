import { releaseDesktopFocus } from "./releaseDesktopFocus.js";
import { runInputSequenceNative } from "../native/win32Bridge.js";

export interface WhatsAppKeysResult {
  ok: boolean;
  foregroundTitle?: string;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * WhatsApp Web: P7 native SendInput sequence in one PowerShell session.
 */
export async function runWhatsAppKeysOnWindow(
  hwnd: number,
  windowTitle: string,
  contact: string,
  message: string,
  send: boolean,
): Promise<WhatsAppKeysResult> {
  if (process.platform !== "win32" || !hwnd) {
    throw new Error("runWhatsAppKeysOnWindow requires a valid hwnd on Windows");
  }

  releaseDesktopFocus();
  await delay(250);

  const titleHint = (windowTitle || "WhatsApp").slice(0, 80);
  const steps: Array<
    | { type: "keys"; value: string; delayMs?: number }
    | { type: "text"; value: string; delayMs?: number }
  > = [
    { type: "keys", value: "^%+{F}", delayMs: 700 },
    { type: "keys", value: "^a", delayMs: 100 },
    { type: "text", value: contact, delayMs: 1100 },
    { type: "keys", value: "{ENTER}", delayMs: 1100 },
    { type: "text", value: message, delayMs: 250 },
  ];

  if (send) {
    steps.push({ type: "keys", value: "{ENTER}", delayMs: 200 });
  }

  try {
    const result = await runInputSequenceNative({
      hwnd,
      titleHint,
      delayMs: 800,
      steps,
    });

    if (!result.ok) {
      throw new Error(
        `Chrome did not keep focus (foreground="${(result.foregroundTitle ?? "").slice(0, 40)}") — keyboard automation aborted`,
      );
    }

    console.warn(
      `[ripple-desktop] KEYBOARD FALLBACK (P7 native) — not verified in WhatsApp DOM. Prefer CDP.`,
    );
    return { ok: true, foregroundTitle: result.foregroundTitle };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ripple-desktop] WhatsApp keys failed:", msg);
    throw new Error(
      `Could not drive WhatsApp in Chrome (${msg}). Keep the WhatsApp tab visible and try again.`,
    );
  }
}
