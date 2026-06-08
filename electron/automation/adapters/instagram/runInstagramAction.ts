import { composeInstagramMessage } from "./composeMessage.js";
import { openInstagramInBrowser } from "./openInstagram.js";
import { sendInstagramMessage } from "./sendMessage.js";

export async function runInstagramBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.instagramKind;

  if (kind === "open") {
    return openInstagramInBrowser();
  }

  if (kind === "message") {
    const username = typeof data?.username === "string" ? data.username.trim() : "";
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    const send = data?.send === true;
    if (!username) throw new Error("Instagram username missing");
    if (!text) throw new Error("Instagram message text missing");
    return sendInstagramMessage({ username, text, send });
  }

  if (kind === "compose") {
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    const send = data?.send === true;
    if (!text) throw new Error("Instagram message text missing");
    return composeInstagramMessage({ text, send });
  }

  throw new Error(`Unknown Instagram action: ${String(kind)}`);
}
