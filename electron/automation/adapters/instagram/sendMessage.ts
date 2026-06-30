import {
  isExtensionBridgeConnected,
  runInstagramViaExtension,
} from "../../../bridge/whatsappExtensionBridge.js";
import { delay } from "../../delay.js";
import { composeInstagramMessage } from "./composeMessage.js";
import { openInstagramInBrowser, shouldUseInstagramActiveTab } from "./openInstagram.js";
import { normalizeSpokenInstagramUsername } from "./instagramUsername.js";

export async function sendInstagramMessage(args: {
  username: string;
  text: string;
  send: boolean;
}): Promise<string> {
  const user = normalizeSpokenInstagramUsername(args.username.trim()).replace(/^@/, "");
  const text = args.text.trim();
  if (!user) throw new Error("Instagram username missing");
  if (!text) throw new Error("Instagram message text missing");

  if (!shouldUseInstagramActiveTab()) {
    await openInstagramInBrowser();
    await delay(2000);
  }

  if (!isExtensionBridgeConnected()) {
    throw new Error(
      "Ripple extension not connected — reload extension at chrome://extensions (see WHATSAPP_SETUP.md)",
    );
  }

  await runInstagramViaExtension({
    username: user,
    text: "",
    send: false,
    navigateOnly: true,
  });
  await delay(1400);
  return composeInstagramMessage({ text, send: args.send });
}
