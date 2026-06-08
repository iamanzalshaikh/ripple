import {
  isExtensionBridgeConnected,
  runLinkedInViaExtension,
} from "../../../bridge/whatsappExtensionBridge.js";
import { delay } from "../../delay.js";
import { openLinkedInInBrowser, shouldUseLinkedInActiveTab } from "./openLinkedIn.js";
import { pasteLinkedInViaKeyboard } from "./linkedinKeyboardPaste.js";

export async function createLinkedInPost(args: {
  text?: string;
  publish: boolean;
}): Promise<string> {
  const body = (args.text ?? "").trim();

  if (!shouldUseLinkedInActiveTab()) {
    await openLinkedInInBrowser();
    await delay(2200);
  }

  if (!isExtensionBridgeConnected()) {
    if (!body) {
      throw new Error(
        "Extension not connected — reload at chrome://extensions (see WHATSAPP_SETUP.md)",
      );
    }
    return pasteLinkedInViaKeyboard(body);
  }

  // 1) Open composer via extension (no text — keyboard paste is more reliable)
  try {
    await runLinkedInViaExtension({
      text: "",
      publish: false,
      pasteOnly: false,
    });
  } catch (openErr: unknown) {
    const openMsg = openErr instanceof Error ? openErr.message : String(openErr);
    console.warn(`[ripple-desktop] LinkedIn open composer failed: ${openMsg}`);
    if (!body) throw openErr;
  }

  if (!body) {
    return "LinkedIn post composer opened";
  }

  await delay(900);

  // 2) Keyboard replace (Ctrl+A → paste) into focused composer
  try {
    await pasteLinkedInViaKeyboard(body);
    if (!args.publish) {
      return `LinkedIn post drafted (${body.length} chars)`;
    }
  } catch (keyErr: unknown) {
    const keyMsg = keyErr instanceof Error ? keyErr.message : String(keyErr);
    console.warn(`[ripple-desktop] LinkedIn keyboard paste failed: ${keyMsg}`);

    // 3) Extension DOM paste fallback
    try {
      return await runLinkedInViaExtension({
        text: body,
        publish: args.publish,
        pasteOnly: true,
      });
    } catch (pasteErr: unknown) {
      const pasteMsg = pasteErr instanceof Error ? pasteErr.message : String(pasteErr);
      throw new Error(
        `LinkedIn post failed. Click "Start a post", click in the text box, then retry. (${pasteMsg})`,
      );
    }
  }

  // 4) Publish — extension clicks Post button
  if (args.publish) {
    return runLinkedInViaExtension({
      text: "",
      publish: true,
      pasteOnly: true,
    });
  }

  return `LinkedIn post drafted (${body.length} chars)`;
}
