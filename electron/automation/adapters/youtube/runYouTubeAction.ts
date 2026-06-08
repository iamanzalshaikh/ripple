import { openYouTubeInBrowser } from "./openYouTube.js";
import { playYouTubeBySearch } from "./playVideo.js";
import { searchYouTube } from "./searchVideo.js";
import {
  isExtensionBridgeConnected,
  runYouTubeViaExtension,
} from "../../../bridge/whatsappExtensionBridge.js";
import { delay } from "../../delay.js";

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
    const detail = await playYouTubeBySearch(query);
    await delay(3500);
    if (!isExtensionBridgeConnected()) {
      console.warn(
        "[ripple-desktop] YouTube auto-play skipped — extension bridge offline (see WHATSAPP_SETUP.md)",
      );
      return `${detail} (extension not connected — showing results)`;
    }
    try {
      const clicked = await runYouTubeViaExtension({ query });
      return `${detail} → ${clicked}`;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[ripple-desktop] YouTube auto-play unavailable: ${msg}`);
      return `${detail} (couldn't auto-play — showing results)`;
    }
  }

  throw new Error(`Unknown YouTube action: ${String(kind)}`);
}
