(function registerRippleSlackListener() {
  const root = globalThis;
  if (root.__rippleSlackListenerRegistered) return;
  root.__rippleSlackListenerRegistered = true;

  const LOG = "[ripple-slack]";
  let lastKey = "";
  let debounce = null;

  function postIngest(payload) {
    try {
      chrome.runtime.sendMessage({ type: "RIPPLE_CROSS_APP_INGEST", ...payload });
    } catch (e) {
      console.warn(LOG, "ingest send failed", e);
    }
  }

  function readSlackContext() {
    const channel =
      document.querySelector("[data-qa='channel_name']")?.textContent?.trim() ||
      document.querySelector(".p-channel_sidebar__channel--selected")?.textContent?.trim() ||
      "";

    const messages = document.querySelectorAll(
      "[data-qa='message_container'], .c-message_kit__blocks",
    );
    let latestFile = "";
    let latestSender = "";
    let latestText = "";

    const start = Math.max(0, messages.length - 8);
    for (let i = messages.length - 1; i >= start; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const sender =
        msg.querySelector("[data-qa='message_sender_name']")?.textContent?.trim() ||
        msg.querySelector(".c-message__sender")?.textContent?.trim() ||
        "";
      const text = msg.textContent?.trim().slice(0, 200) || "";
      const file =
        msg.querySelector("[data-qa='file_name'], .c-file_entity__text")?.textContent?.trim() ||
        "";

      if (file && !latestFile) {
        latestFile = file;
        latestSender = sender;
        latestText = text;
        break;
      }
      if (text && !latestText) {
        latestSender = sender;
        latestText = text;
      }
    }

    if (!latestFile && !latestText) return null;

    const contact = latestSender.replace(/[^a-z0-9 _-]/gi, "").trim().slice(0, 80);
    const summary = latestFile
      ? `${latestSender || "Someone"} shared file: ${latestFile}`
      : `${latestSender || "Someone"}: ${latestText}`.slice(0, 480);

    return { summary, contact, channel, url: location.href, latestFile };
  }

  function maybeIngest() {
    const ctx = readSlackContext();
    if (!ctx) return;
    const key = `${ctx.url}|${ctx.summary}`;
    if (key === lastKey) return;
    lastKey = key;

    postIngest({
      appId: "slack",
      summary: ctx.summary,
      contact: ctx.contact || undefined,
      attachments: ctx.latestFile ? [ctx.latestFile] : undefined,
      command: `Slack${ctx.channel ? ` #${ctx.channel}` : ""}: ${ctx.summary.slice(0, 120)}`,
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
