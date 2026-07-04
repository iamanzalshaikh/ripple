(function registerRippleTeamsListener() {
  const root = globalThis;
  if (root.__rippleTeamsListenerRegistered) return;
  root.__rippleTeamsListenerRegistered = true;

  const LOG = "[ripple-teams]";
  let lastKey = "";
  let debounce = null;

  function postIngest(payload) {
    try {
      chrome.runtime.sendMessage({ type: "RIPPLE_CROSS_APP_INGEST", ...payload });
    } catch (e) {
      console.warn(LOG, "ingest send failed", e);
    }
  }

  function readTeamsContext() {
    const channel =
      document.querySelector('[data-tid="chat-pane-title"]')?.textContent?.trim() ||
      document.querySelector('[data-tid="channelTitle"]')?.textContent?.trim() ||
      document.querySelector("h2")?.textContent?.trim() ||
      "";

    const attachments = [];
    const seen = new Set();
    let latestSender = channel;
    let latestText = "";

    for (const el of document.querySelectorAll(
      '[data-tid="file-attachment"], [data-tid="attachment"], [aria-label*="file"]',
    )) {
      const name =
        el.getAttribute?.("aria-label")?.trim() ||
        el.textContent?.trim() ||
        "";
      if (name.length >= 3 && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        attachments.push(name.slice(0, 120));
      }
    }

    const messages = document.querySelectorAll('[data-tid="message-body"], [id*="message"]');
    const start = Math.max(0, messages.length - 8);
    for (let i = messages.length - 1; i >= start; i--) {
      const text = messages[i]?.textContent?.trim().slice(0, 200) || "";
      if (text.length > 8) {
        latestText = text;
        break;
      }
    }

    if (!channel && !attachments.length && !latestText) return null;

    const contact = channel.slice(0, 80);
    const summary = attachments.length
      ? `Teams file in ${channel || "chat"}: ${attachments.join(", ")}`
      : `Teams — ${channel}: ${latestText}`.slice(0, 480);

    return {
      summary,
      contact,
      attachments,
      url: location.href,
    };
  }

  function maybeIngest() {
    const ctx = readTeamsContext();
    if (!ctx) return;
    const key = `${ctx.url}|${ctx.summary}`;
    if (key === lastKey) return;
    lastKey = key;

    postIngest({
      appId: "teams",
      summary: ctx.summary,
      contact: ctx.contact || undefined,
      attachments: ctx.attachments?.length ? ctx.attachments : undefined,
      command: `Teams: ${ctx.contact || "chat"}`,
      externalUrl: ctx.url,
    });
    console.info(LOG, "ingest queued", ctx.summary.slice(0, 80));
  }

  function schedule() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(maybeIngest, 1500);
  }

  const obs = new MutationObserver(schedule);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
