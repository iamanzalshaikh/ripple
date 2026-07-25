import { clipboard } from "electron";
import { restoreFocusContext } from "../../../focus/focusContext.js";
import {
  isExtensionBridgeConnected,
  runInstagramViaExtension,
} from "../../../bridge/whatsappExtensionBridge.js";
import { delay } from "../../delay.js";
import { pasteFromClipboard, selectAll } from "../../keyboard.js";
import { focusInstagramComposer } from "./focusComposer.js";
import { shouldUseInstagramActiveTab } from "./openInstagram.js";
import { insertInstagramComposeText } from "./instagramComposeInsert.js";

/** Paste into the open Instagram DM composer (active thread only). */
export async function composeInstagramMessage(args: {
  text: string;
  send: boolean;
  /** Append at caret (default for open-thread compose). */
  pasteOnly?: boolean;
  /** Clear composer first (rephrase / tone). */
  replaceAll?: boolean;
}): Promise<string> {
  const text = args.text.trim();
  if (!text) throw new Error("Instagram message text missing");

  if (!shouldUseInstagramActiveTab()) {
    throw new Error(
      'Open a DM thread first, or say e.g. "Message Anzal Sheikh saying how are you" from inbox',
    );
  }

  const replaceAll = args.replaceAll === true;

  // Prefer the shared OS-first path (clipboard append, no accidental select-all).
  // Legacy selectAll+paste only for explicit replace when the ladder path fails.
  try {
    await insertInstagramComposeText(text, { replaceAll });
  } catch (e: unknown) {
    if (!replaceAll) throw e;
    console.warn(
      "[ripple-desktop] Instagram compose ladder failed; falling back to selectAll paste:",
      e instanceof Error ? e.message : e,
    );
    await focusInstagramComposer();
    const restored = await restoreFocusContext();
    if (!restored) {
      throw new Error(
        "Could not restore focus to Instagram — click the message box and retry",
      );
    }
    await delay(400);
    clipboard.writeText(text);
    await delay(80);
    await selectAll();
    await delay(80);
    await pasteFromClipboard();
  }

  if (!args.send) {
    return `Draft ready (${text.length} chars)`;
  }

  if (!isExtensionBridgeConnected()) {
    throw new Error(
      "Extension not connected — reload at chrome://extensions to send",
    );
  }

  return runInstagramViaExtension({
    username: "",
    text: "",
    send: true,
    sendOnly: true,
  });
}
