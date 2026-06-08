// Ripple YouTube DOM helper (MV3 content script)
// Receives: { type: "YOUTUBE_PLAY", query: string }
// Responds: { ok: boolean, detail?: string, error?: string }

(function registerRippleYouTubeListener() {
  const root = globalThis;
  if (root.__rippleYouTubeListenerRegistered) return;
  root.__rippleYouTubeListenerRegistered = true;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function normalizeText(s) {
    return String(s ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(s) {
    const t = normalizeText(s);
    if (!t) return [];
    return t.split(" ").filter(Boolean);
  }

  function scoreTitle(query, title) {
    const q = tokens(query);
    const tt = tokens(title);
    if (q.length === 0 || tt.length === 0) return 0;
    const set = new Set(tt);
    let hit = 0;
    for (const w of q) if (set.has(w)) hit++;
    // favor longer overlap and earlier words
    const ratio = hit / q.length;
    const bonus = hit >= 3 ? 0.15 : hit === 2 ? 0.08 : hit === 1 ? 0.03 : 0;
    return ratio + bonus;
  }

  function isShortsHref(href) {
    return typeof href === "string" && href.includes("/shorts/");
  }

  function isPlaylistHref(href) {
    return typeof href === "string" && (href.includes("/playlist") || href.includes("list="));
  }

  function isSponsoredRenderer(el) {
    if (!el) return false;
    // Common sponsored containers on results
    return (
      el.closest("ytd-promoted-video-renderer") ||
      el.closest("ytd-ad-slot-renderer") ||
      el.querySelector?.("ytd-ad-badge-renderer") ||
      el.querySelector?.("span#ad-badge") ||
      el.querySelector?.('[aria-label*="Sponsored"]')
    );
  }

  function pickBestVideoCard(query) {
    const renderers = Array.from(document.querySelectorAll("ytd-video-renderer"));
    const candidates = [];
    for (const r of renderers) {
      const a = r.querySelector('a#video-title');
      const title = a?.textContent?.trim() ?? "";
      const href = a?.href ?? "";
      if (!a || !title) continue;
      if (isSponsoredRenderer(r)) continue;
      if (isShortsHref(href)) continue;
      if (isPlaylistHref(href)) continue;
      const s = scoreTitle(query, title);
      candidates.push({ a, title, href, s });
    }
    candidates.sort((x, y) => y.s - x.s);
    return candidates[0] ?? null;
  }

  async function waitForResults(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (document.querySelector("ytd-video-renderer a#video-title")) return true;
      if (document.querySelector("ytd-item-section-renderer a#video-title")) return true;
      await sleep(300);
    }
    return false;
  }

  async function runYouTubePlay(query) {
    const ok = await waitForResults(12000);
    if (!ok) {
      return { ok: false, error: "Timed out waiting for YouTube results" };
    }

    const best = pickBestVideoCard(query);
    if (!best || !best.a) {
      return { ok: false, error: "No suitable video results found (ads/shorts filtered)" };
    }

    // Require some minimal match quality; otherwise leave results open.
    if (best.s < 0.25) {
      return {
        ok: false,
        error: `No close match found (best=\"${best.title.slice(0, 60)}\")`,
      };
    }

    best.a.click();
    return { ok: true, detail: `Clicked: ${best.title.slice(0, 80)}` };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "YOUTUBE_PLAY") return;
    const query = String(msg.query ?? "").trim();
    if (!query) {
      sendResponse({ ok: false, error: "Missing query" });
      return true;
    }
    (async () => {
      try {
        const res = await runYouTubePlay(query);
        sendResponse(res);
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message ?? e) });
      }
    })();
    return true;
  });
})();

