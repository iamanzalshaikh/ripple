import { captureObservation } from "../../../agent/observe.js";
import { replaceWhatsAppComposerViaExtension } from "../../../bridge/nativeMessagingBridge.js";
import { restoreFocusContext } from "../../../focus/focusContext.js";
import { getInsertTextA11yDiagnostics } from "../../../native/win32Bridge.js";
import { runInsertWithFallback } from "../../input/inputStrategy.js";
import { selectAll, sendKeyChord } from "../../keyboard.js";
import { pushUndoAction } from "../../safety/undoStack.js";

export type WhatsAppComposeInsertOptions = {
  /** Clear the open composer before typing (rephrase / tone replace). */
  replaceAll?: boolean;
};

/**
 * P7.3 — Wispr-style open-chat insertion.
 *
 * Prefer OS input into the already-focused WhatsApp composer. The extension
 * DOM replacement is retained only as an app-specific fallback because
 * WhatsApp's contenteditable implementation changes frequently.
 */
export async function insertWhatsAppComposeText(
  text: string,
  options?: WhatsAppComposeInsertOptions,
): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error("No message text for WhatsApp compose");

  await restoreFocusContext();
  await new Promise((resolve) => setTimeout(resolve, 240));

  if (options?.replaceAll) {
    try {
      const diag = await getInsertTextA11yDiagnostics();
      const previousText = diag?.focused?.value?.trim();
      if (previousText) {
        pushUndoAction({
          kind: "restore_text_field",
          previousText,
          surface: "whatsapp",
        });
      }
    } catch {
      /* undo capture is best-effort */
    }

    // runInputSequenceNative (native RPC targeting a specific hwnd) does not
    // reliably reach WhatsApp Web's contenteditable box — confirmed via the
    // verify-and-retry loop this replaced, which consistently reported
    // composer_clear_unverified. Use the same mechanism that already works
    // for the generic replace-in-place path (Gmail etc.): PowerShell
    // SendKeys targeting whatever currently holds OS foreground focus.
    let cleared = false;
    for (let attempt = 0; attempt < 3 && !cleared; attempt++) {
      await selectAll();
      await sendKeyChord("{BACKSPACE}");
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        const diag = await getInsertTextA11yDiagnostics();
        const remaining = diag?.focused?.value?.trim() ?? "";
        cleared = remaining.length === 0;
      } catch {
        // Can't verify — assume it worked rather than looping forever.
        cleared = true;
      }
    }
    if (!cleared) {
      console.warn(
        "[ripple-insert] surface=whatsapp composer_clear_unverified — typing anyway",
      );
    }
  }

  const beforeObserve = await captureObservation();

  try {
    const result = await runInsertWithFallback(body, {
      verify: process.env.RIPPLE_P85_INSERT_VERIFY !== "0",
      beforeObserve,
      includeVision: false,
      acceptUnverifiableEdit: true,
      replaceAll: options?.replaceAll === true,
    });
    console.info(
      `[ripple-insert] surface=whatsapp strategy=${result.strategy} status=ok`,
    );
    return result.detail;
  } catch (osError: unknown) {
    console.warn(
      "[ripple-insert] surface=whatsapp os_ladder=exhausted; trying extension fallback:",
      osError instanceof Error ? osError.message : osError,
    );
  }

  try {
    const detail = await replaceWhatsAppComposerViaExtension(body);
    console.info(
      "[ripple-insert] surface=whatsapp strategy=extension status=ok",
    );
    return detail;
  } catch (extensionError: unknown) {
    console.warn(
      "[ripple-insert] surface=whatsapp strategy=extension status=fail:",
      extensionError instanceof Error ? extensionError.message : extensionError,
    );
    throw new Error(
      `Could not type into WhatsApp composer: ${
        extensionError instanceof Error
          ? extensionError.message
          : "all insert strategies failed"
      }`,
    );
  }
}
