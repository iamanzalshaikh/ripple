import { searchYouTube } from "./searchVideo.js";

/**
 * B4: "Play X on YouTube" → search results in the **same tab** when YouTube is focused.
 * User selects a video to start playback (auto-play first result = Phase 4+).
 */
export async function playYouTubeBySearch(query: string): Promise<string> {
  const detail = await searchYouTube(query);
  return `${detail} — select a video to play`;
}
