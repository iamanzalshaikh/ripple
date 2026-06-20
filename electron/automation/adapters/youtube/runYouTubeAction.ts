import { openYouTubeInBrowser } from "./openYouTube.js";
import { searchYouTube } from "./searchVideo.js";
import {
  isExtensionBridgeConnected,
  runYouTubeViaExtension,
} from "../../../bridge/whatsappExtensionBridge.js";

const EXTENSION_SETUP_HINT =
  "Ripple Chrome extension not connected — reload it at chrome://extensions and run native-host/install-windows.ps1 (see WHATSAPP_SETUP.md).";

export async function runYouTubeBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.youtubeKind;
  const query = typeof data?.query === "string" ? data.query.trim() : "";

  if (kind === "open") {
    return openYouTubeInBrowser();
  }

  if (kind === "search") {
    if (!query) throw new Error("YouTube search query missing");
    return searchYouTube(query);
  }

  if (kind === "play") {
    if (!query) throw new Error("YouTube play query missing");
    if (!isExtensionBridgeConnected()) {
      throw new Error(EXTENSION_SETUP_HINT);
    }
    console.info(
      `[ripple-desktop] YouTube play via extension — q="${query.slice(0, 80)}"`,
    );
    const clicked = await runYouTubeViaExtension({ query });
    return `YouTube play — ${clicked}`;
  }

  throw new Error(`Unknown YouTube action: ${String(kind)}`);
}
