(function registerRippleWhatsAppIngest() {
  const root = globalThis;
  if (root.__rippleWaIngestRegistered) return;
  root.__rippleWaIngestRegistered = true;

  const LOG = "[ripple-whatsapp-ingest]";
  let lastKey = "";
  let debounce = null;

  function postIngest(payload) {
    try {
      chrome.runtime.sendMessage({ type: "RIPPLE_CROSS_APP_INGEST", ...payload });
    } catch (e) {
      console.warn(LOG, "ingest send failed", e);
    }
  }

  function readActiveContact() {
    return (
      document.querySelector("#main header span[title]")?.getAttribute("title")?.trim() ||
      document.querySelector("#main header h1")?.textContent?.trim() ||
      document.querySelector("#main header span[dir='auto']")?.textContent?.trim() ||
      ""
    );
  }

  function collectAttachments(main) {
    const attachments = [];
    const seen = new Set();

    function push(name) {
      const n = (name || "").trim();
      if (n.length < 3) return;
      const key = n.toLowerCase();
      if (seen.has(key)) return;
      const looksLikeFile =
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|png|jpe?g|csv|txt|mp4|mov)\b/i.test(n) ||
        /\b(pdf|document|spreadsheet|presentation)\b/i.test(n);
      if (!looksLikeFile && n.length < 8) return;
      seen.add(key);
      attachments.push(n.slice(0, 120));
    }

    for (const bubble of main.querySelectorAll(
      '[data-testid="msg-container"], [role="row"]',
    )) {
      const name =
        bubble.querySelector('[data-testid="document-filename"]')?.textContent?.trim() ||
        bubble.querySelector("span[title*='.']")?.getAttribute("title")?.trim() ||
        bubble.querySelector('[data-icon="document"]')?.closest('[role="row"]')?.querySelector("span[dir='ltr']")?.textContent?.trim() ||
        "";
      if (name) push(name);
    }

    for (const span of main.querySelectorAll("span[title]")) {
      const t = span.getAttribute("title")?.trim() || "";
      if (/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|png|jpe?g|csv|txt)\b/i.test(t)) {
        push(t);
      }
    }

    return attachments.slice(0, 8);
  }

  function readWhatsAppContext() {
    const contact = readActiveContact();
    if (!contact || contact.length < 2) return null;

    const main = document.querySelector("#main");
    if (!main) return null;

    const attachments = collectAttachments(main);

    let latestText = "";
    const messages = main.querySelectorAll('[data-testid="msg-container"], [role="row"]');
    const start = Math.max(0, messages.length - 8);
    for (let i = messages.length - 1; i >= start; i--) {
      const msg = messages[i];
      if (!msg) continue;
      const text = msg.textContent?.trim().replace(/\s+/g, " ").slice(0, 220) || "";
      if (text.length > 8) {
        latestText = text;
        break;
      }
    }

    if (!attachments.length && !latestText) return null;

    const summary = attachments.length
      ? `WhatsApp file from ${contact}: ${attachments.join(", ")}`
      : `WhatsApp with ${contact}: ${latestText}`.slice(0, 480);

    return {
      summary,
      contact: contact.slice(0, 80),
      attachments,
      url: location.href,
    };
  }

  function maybeIngest() {
    const ctx = readWhatsAppContext();
    if (!ctx) return;
    const key = `${ctx.url}|${ctx.contact}|${ctx.summary}`;
    if (key === lastKey) return;
    lastKey = key;

    postIngest({
      appId: "whatsapp",
      summary: ctx.summary,
      contact: ctx.contact || undefined,
      attachments: ctx.attachments?.length ? ctx.attachments : undefined,
      command: `WhatsApp chat: ${ctx.contact}`,
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
  window.addEventListener("popstate", schedule);
  document.addEventListener("click", schedule, true);
})();
