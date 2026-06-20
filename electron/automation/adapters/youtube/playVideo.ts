import { searchYouTube } from "./searchVideo.js";

/**
 * B4: "Play X on YouTube" — search in tab (extension handles auto-play separately).
 */
export async function playYouTubeBySearch(query: string): Promise<string> {
  const detail = await searchYouTube(query);
  return `${detail} — select a video to play`;
}
