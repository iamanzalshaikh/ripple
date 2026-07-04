(function registerRippleGmailListener() {
  const root = globalThis;
  if (root.__rippleGmailListenerRegistered) return;
  root.__rippleGmailListenerRegistered = true;

  const LOG = "[ripple-gmail]";
  let lastKey = "";
  let debounce = null;

  function postIngest(payload) {
    try {
      chrome.runtime.sendMessage({ type: "RIPPLE_CROSS_APP_INGEST", ...payload });
    } catch (e) {
      console.warn(LOG, "ingest send failed", e);
    }
  }

  function collectAttachments(root) {
    const attachments = [];
    const seen = new Set();
    const push = (name) => {
      const n = (name || "").trim();
      if (n.length < 3) return;
      const key = n.toLowerCase();
      if (seen.has(key)) return;
      const looksLikeFile =
        /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|png|jpe?g|csv|txt)\b/i.test(n) ||
        /\b(pdf|document|spreadsheet|presentation)\b/i.test(n);
      if (!looksLikeFile && n.length < 8) return;
      seen.add(key);
      attachments.push(n.slice(0, 120));
    };

    for (const el of root.querySelectorAll(
      "span.aZo, span.aV3, [download_url], [data-tooltip], [aria-label]",
    )) {
      const t =
        el.getAttribute?.("data-tooltip") ||
        el.getAttribute?.("aria-label") ||
        el.textContent?.trim();
      if (t) push(t);
    }
    return attachments.slice(0, 8);
  }

  function readOpenThreadContext() {
    const subject =
      document.querySelector("h2.hP")?.textContent?.trim() ||
      document.querySelector("[data-legacy-thread-id] h2")?.textContent?.trim() ||
      "";

    if (!subject && !document.querySelector("span.gD[email]")) return null;

    const fromEl =
      document.querySelector("span.gD[email]") ||
      document.querySelector(".gE.iv.gt span[email]") ||
      document.querySelector("[data-message-id] span[email]");
    const fromEmail = fromEl?.getAttribute?.("email")?.trim() || "";
    const fromName =
      fromEl?.getAttribute?.("name")?.trim() ||
      fromEl?.textContent?.trim() ||
      "";

    const attachments = collectAttachments(document);

    const resolvedSubject =
      subject || document.title.replace(/\s*-\s*Gmail.*/i, "").trim();

    if (!resolvedSubject && !fromEmail && attachments.length === 0) return null;

    const contact = (fromName || fromEmail.split("@")[0] || "").slice(0, 80);
    const summary = [
      fromName || fromEmail ? `From: ${fromName || fromEmail}` : "",
      resolvedSubject ? `Email: ${resolvedSubject}` : "",
      attachments.length ? `Attachments: ${attachments.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 480);

    if (!summary) return null;
    return {
      summary,
      contact,
      subject: resolvedSubject || fromName,
      url: location.href,
      attachments,
    };
  }

  function readInboxRowContext() {
    if (document.querySelector("h2.hP")?.textContent?.trim()) return null;

    const row =
      document.querySelector("tr.zA.btb") ||
      document.querySelector("tr.zA.x7") ||
      document.querySelector("tr.zA[aria-checked='true']") ||
      document.querySelector("tr.zA.zE") ||
      document.querySelector("div[role='main'] tr.zA");

    if (!row) return null;

    const fromEl =
      row.querySelector("span.gD[email]") ||
      row.querySelector("span[email]") ||
      row.querySelector(".yW span[email]");
    const fromEmail = fromEl?.getAttribute?.("email")?.trim() || "";
    const fromName =
      fromEl?.getAttribute?.("name")?.trim() ||
      fromEl?.textContent?.trim() ||
      row.querySelector(".yW .zF")?.textContent?.trim() ||
      "";

    const subjectEl =
      row.querySelector("span.bog") ||
      row.querySelector(".y6 span.bog") ||
      row.querySelector(".bqe");
    const subject = subjectEl?.textContent?.trim() || "";

    if (!subject && !fromEmail && !fromName) return null;

    const contact = (fromName || fromEmail.split("@")[0] || "").slice(0, 80);
    const summary = [
      fromName || fromEmail ? `From: ${fromName || fromEmail}` : "",
      subject ? `Email: ${subject}` : "",
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 480);

    if (!summary) return null;
    return {
      summary,
      contact,
      subject: subject || fromName,
      url: location.href,
    };
  }

  function readThreadContext() {
    return readOpenThreadContext() || readInboxRowContext();
  }

  function queueAttachmentDownloads(ctx) {
    if (!ctx?.attachments?.length) return;
    const seen = new Set();
    for (const el of document.querySelectorAll("[download_url]")) {
      const url = el.getAttribute("download_url");
      const name =
        el.getAttribute("data-tooltip") ||
        el.getAttribute("aria-label") ||
        el.textContent?.trim() ||
        "";
      if (!url || !name || seen.has(url)) continue;
      seen.add(url);
      try {
        chrome.runtime.sendMessage({
          type: "RIPPLE_DOWNLOAD_GMAIL_ATTACHMENT",
          url,
          fileName: name.slice(0, 120),
          appId: "gmail",
          contact: ctx.contact,
          pageUrl: ctx.url,
          summary: ctx.summary,
        });
      } catch (e) {
        console.warn(LOG, "download queue failed", e);
      }
    }
  }

  function maybeIngest() {
    const ctx = readThreadContext();
    if (!ctx) return;
    const key = `${ctx.url}|${ctx.summary}`;
    if (key === lastKey) return;
    lastKey = key;

    postIngest({
      appId: "gmail",
      summary: ctx.summary,
      contact: ctx.contact || undefined,
      attachments: ctx.attachments?.length ? ctx.attachments : undefined,
      command: `Gmail thread: ${ctx.subject || "message"}`,
      externalUrl: ctx.url,
    });
    queueAttachmentDownloads(ctx);
    console.info(LOG, "ingest queued", ctx.summary.slice(0, 80));
  }

  function schedule() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(maybeIngest, 1200);
  }

  const obs = new MutationObserver(schedule);
  obs.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  document.addEventListener(
    "click",
    (e) => {
      if (e.target?.closest?.("tr.zA")) schedule();
    },
    true,
  );
})();
