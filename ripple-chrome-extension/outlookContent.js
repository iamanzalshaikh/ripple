(function registerRippleOutlookListener() {
  const root = globalThis;
  if (root.__rippleOutlookListenerRegistered) return;
  root.__rippleOutlookListenerRegistered = true;

  const LOG = "[ripple-outlook]";
  let lastKey = "";
  let debounce = null;

  function postIngest(payload) {
    try {
      chrome.runtime.sendMessage({ type: "RIPPLE_CROSS_APP_INGEST", ...payload });
    } catch (e) {
      console.warn(LOG, "ingest send failed", e);
    }
  }

  function readOutlookContext() {
    const subject =
      document.querySelector('[aria-label*="Subject"]')?.textContent?.trim() ||
      document.querySelector('[role="heading"][aria-level="2"]')?.textContent?.trim() ||
      document.querySelector(".allowTextSelection")?.querySelector("span")?.textContent?.trim() ||
      "";

    const from =
      document.querySelector('[aria-label^="From"]')?.textContent?.replace(/^From\s*/i, "").trim() ||
      document.querySelector('[data-testid="persona-name"]')?.textContent?.trim() ||
      "";

    const attachments = [];
    const seen = new Set();
    for (const el of document.querySelectorAll(
      '[aria-label*="attachment"], [data-icon-name="Attach"], .av-container',
    )) {
      const t =
        el.getAttribute?.("aria-label")?.replace(/attachment[s]?\s*/i, "").trim() ||
        el.textContent?.trim();
      if (!t || t.length < 3 || seen.has(t.toLowerCase())) continue;
      if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|png|jpg)\b/i.test(t) || t.length >= 6) {
        seen.add(t.toLowerCase());
        attachments.push(t.slice(0, 120));
      }
    }

    if (!subject && !from && attachments.length === 0) return null;

    const contact = from.split("<")[0].trim().slice(0, 80);
    const summary = [
      from ? `From: ${from}` : "",
      subject ? `Email: ${subject}` : "",
      attachments.length ? `Attachments: ${attachments.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 480);

    return {
      summary,
      contact,
      subject: subject || from,
      attachments,
      url: location.href,
    };
  }

  function maybeIngest() {
    const ctx = readOutlookContext();
    if (!ctx) return;
    const key = `${ctx.url}|${ctx.summary}`;
    if (key === lastKey) return;
    lastKey = key;

    postIngest({
      appId: "outlook",
      summary: ctx.summary,
      contact: ctx.contact || undefined,
      attachments: ctx.attachments?.length ? ctx.attachments : undefined,
      command: `Outlook: ${ctx.subject || "message"}`,
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
