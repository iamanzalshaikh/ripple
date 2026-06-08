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

/** Replace all text in the focused Instagram DM composer (Ctrl+A → paste). */
async function replaceInComposer(text: string): Promise<void> {
  await focusInstagramComposer();
  const restored = await restoreFocusContext();
  if (!restored) {
    throw new Error("Could not restore focus to Instagram — click the message box and retry");
  }
  await delay(500);
  clipboard.writeText(text);
  await delay(80);
  await selectAll();
  await delay(80);
  await pasteFromClipboard();
}

/** Paste into the open Instagram DM composer (active thread only). */
export async function composeInstagramMessage(args: {
  text: string;
  send: boolean;
}): Promise<string> {
  const text = args.text.trim();
  if (!text) throw new Error("Instagram message text missing");

  if (!shouldUseInstagramActiveTab()) {
    throw new Error(
      'Open a DM thread first, or say e.g. "Message Anzal Sheikh saying how are you" from inbox',
    );
  }

  await replaceInComposer(text);

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
