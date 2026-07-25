import { captureObservation } from "../../../agent/observe.js";
import { restoreFocusContext } from "../../../focus/focusContext.js";
import { getInsertTextA11yDiagnostics } from "../../../native/win32Bridge.js";
import { runInsertWithFallback } from "../../input/inputStrategy.js";
import { selectAll, sendKeyChord } from "../../keyboard.js";
import { pushUndoAction } from "../../safety/undoStack.js";
import { focusInstagramComposer } from "./focusComposer.js";

export type InstagramComposeInsertOptions = {
  /** Clear the open composer before typing (rephrase / tone replace). */
  replaceAll?: boolean;
};

/**
 * Open-thread Instagram DM insert — append by default (Wispr-style).
 * Prefer clipboard paste; never select-all on append (that wiped prior
 * dictation on the second utterance).
 */
export async function insertInstagramComposeText(
  text: string,
  options?: InstagramComposeInsertOptions,
): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error("No message text for Instagram compose");

  await restoreFocusContext();
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    await focusInstagramComposer();
  } catch {
    /* best-effort — Message... may already hold keyboard focus */
  }
  await new Promise((resolve) => setTimeout(resolve, 120));

  if (options?.replaceAll) {
    try {
      const diag = await getInsertTextA11yDiagnostics();
      const previousText = diag?.focused?.value?.trim();
      if (previousText) {
        pushUndoAction({
          kind: "restore_text_field",
          previousText,
          surface: "instagram",
        });
      }
    } catch {
      /* undo capture is best-effort */
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await selectAll();
      await sendKeyChord("{BACKSPACE}");
      await new Promise((resolve) => setTimeout(resolve, 120));
      try {
        const diag = await getInsertTextA11yDiagnostics();
        if (!(diag?.focused?.value?.trim() ?? "")) break;
      } catch {
        break;
      }
    }
  }

  let insertBody = body;
  if (!options?.replaceAll) {
    try {
      const diag = await getInsertTextA11yDiagnostics();
      const existing = diag?.focused?.value ?? "";
      if (existing && !/\s$/.test(existing) && !/^\s/.test(body)) {
        insertBody = ` ${body}`;
      }
    } catch {
      /* ignore */
    }
  }

  const beforeObserve = await captureObservation();
  const preferClipboard = options?.replaceAll !== true;

  const result = await runInsertWithFallback(insertBody, {
    verify: process.env.RIPPLE_P85_INSERT_VERIFY !== "0",
    beforeObserve,
    includeVision: false,
    acceptUnverifiableEdit: true,
    replaceAll: options?.replaceAll === true,
    preferFirst: preferClipboard ? "clipboard_paste" : undefined,
    abortLadderOnPartialNativeFail: true,
  });
  console.info(
    `[ripple-insert] surface=instagram strategy=${result.strategy} status=ok`,
  );
  return result.detail;
}
