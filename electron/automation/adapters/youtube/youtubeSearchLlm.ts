import { API_BASE } from "../../../services/api.js";

export type YouTubeSearchPlan = {
  query: string;
  kind: "search" | "play";
  confidence: number;
};

export async function fetchYouTubeSearchQueryFromLlm(
  accessToken: string,
  command: string,
): Promise<YouTubeSearchPlan | null> {
  const trimmed = command.trim();
  if (!trimmed) return null;

  console.info(
    `[ripple-desktop] GPT YouTube search query (${trimmed.slice(0, 60)}…)`,
  );

  try {
    const res = await fetch(`${API_BASE}/commands/youtube-search-query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: trimmed }),
    });

    const body = (await res.json()) as {
      success: boolean;
      data?: { plan: YouTubeSearchPlan };
      message?: string;
    };

    if (!res.ok || !body.success || !body.data?.plan?.query) {
      console.warn(
        `[ripple-desktop] GPT YouTube search failed: ${body.message ?? res.status}`,
      );
      return null;
    }

    console.info(
      `[ripple-desktop] GPT YouTube search: "${body.data.plan.query}" (kind=${body.data.plan.kind}, conf=${body.data.plan.confidence})`,
    );
    return body.data.plan;
  } catch (e: unknown) {
    console.warn(
      "[ripple-desktop] GPT YouTube search error:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
