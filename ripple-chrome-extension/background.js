const NATIVE_HOST = "com.ripple.whatsapp";
let nativePort = null;
let reconnectTimer = null;
let reconnectDelayMs = 3000;
const MAX_RECONNECT_MS = 30_000;
const pendingDownloads = new Map();

function sanitizeFileName(name) {
  return String(name ?? "attachment")
    .replace(/[<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

async function runOnWhatsAppTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (!msg.includes("Receiving end does not exist")) {
      throw e;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await new Promise((r) => setTimeout(r, 400));
    const result = await chrome.tabs.sendMessage(tabId, payload);
    return result;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNative();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(Math.round(reconnectDelayMs * 1.5), MAX_RECONNECT_MS);
}

async function runOnTab(tabId, payload, scriptFile) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    const msgText = String(e?.message ?? e);
    if (!msgText.includes("Receiving end does not exist")) throw e;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptFile],
    });
    await new Promise((r) => setTimeout(r, 450));
    return chrome.tabs.sendMessage(tabId, payload);
  }
}

async function pickTab(urlPattern) {
  const active = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: urlPattern,
  });
  const all = await chrome.tabs.query({ url: urlPattern });
  return (
    (active[0]?.id && !active[0].discarded ? active[0] : null) ??
    all.find((t) => t.id && !t.discarded) ??
    all[0] ??
    null
  );
}

async function focusTab(tab) {
  if (!tab?.id) return;
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

function connectNative() {
  if (nativePort) return;

  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    console.error("[ripple-ext] connectNative failed:", e);
    scheduleReconnect();
    return;
  }

  nativePort.onMessage.addListener(async (msg) => {
    if (
      msg?.type !== "WHATSAPP_RUN" &&
      msg?.type !== "YOUTUBE_PLAY" &&
      msg?.type !== "LINKEDIN_CREATE_POST" &&
      msg?.type !== "INSTAGRAM_MESSAGE" &&
      msg?.type !== "INSTAGRAM_READ_COMPOSER" &&
      msg?.type !== "INSTAGRAM_FOCUS_COMPOSER" &&
      msg?.type !== "WHATSAPP_READ_COMPOSER" &&
      msg?.type !== "WHATSAPP_REPLACE_COMPOSER" &&
      msg?.type !== "GET_ACTIVE_TAB_INFO"
    ) {
      return;
    }

    if (msg?.type === "INSTAGRAM_READ_COMPOSER" || msg?.type === "INSTAGRAM_FOCUS_COMPOSER") {
      const id = msg.id;
      const focusOnly = msg?.type === "INSTAGRAM_FOCUS_COMPOSER";
      try {
        let tab = await pickTab("https://www.instagram.com/*");
        if (!tab?.id) {
          throw new Error("Instagram tab not found");
        }
        await focusTab(tab);
        await new Promise((r) => setTimeout(r, 350));
        const result = await runOnTab(
          tab.id,
          focusOnly
            ? { type: "INSTAGRAM_FOCUS_COMPOSER" }
            : { type: "INSTAGRAM_READ_COMPOSER" },
          "instagramContent.js",
        );
        if (focusOnly) {
          nativePort.postMessage({
            type: "INSTAGRAM_RESULT",
            id,
            ok: !!result?.ok,
            error: result?.error,
            detail: result?.detail ?? "Composer focused",
          });
        } else {
          nativePort.postMessage({
            type: "INSTAGRAM_COMPOSER_RESULT",
            id,
            ok: !!result?.ok,
            text: result?.text ?? "",
            error: result?.error,
          });
        }
      } catch (e) {
        const err = String(e?.message ?? e);
        if (focusOnly) {
          nativePort.postMessage({ type: "INSTAGRAM_RESULT", id, ok: false, error: err });
        } else {
          nativePort.postMessage({
            type: "INSTAGRAM_COMPOSER_RESULT",
            id,
            ok: false,
            error: err,
          });
        }
      }
      return;
    }

    if (msg?.type === "WHATSAPP_READ_COMPOSER" || msg?.type === "WHATSAPP_REPLACE_COMPOSER") {
      const id = msg.id;
      const replace = msg?.type === "WHATSAPP_REPLACE_COMPOSER";
      try {
        let tab = await pickTab("https://web.whatsapp.com/*");
        if (!tab?.id) {
          throw new Error("WhatsApp tab not found — open web.whatsapp.com in Chrome or Edge");
        }
        await focusTab(tab);
        await new Promise((r) => setTimeout(r, 350));
        const result = await runOnTab(
          tab.id,
          {
            type: replace ? "WHATSAPP_REPLACE_COMPOSER" : "WHATSAPP_READ_COMPOSER",
            text: msg.text ?? "",
          },
          "content.js",
        );
        nativePort.postMessage({
          type: "WHATSAPP_COMPOSER_RESULT",
          id,
          ok: !!result?.ok,
          text: result?.text ?? "",
          error: result?.error,
          detail: result?.detail ?? result?.text ?? "",
        });
      } catch (e) {
        nativePort.postMessage({
          type: "WHATSAPP_COMPOSER_RESULT",
          id,
          ok: false,
          error: String(e?.message ?? e),
        });
      }
      return;
    }

    if (msg?.type === "GET_ACTIVE_TAB_INFO") {
      const id = msg.id;
      try {
        const active = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = active[0] ?? (await pickTab("https://*/*"));
        nativePort.postMessage({
          type: "ACTIVE_TAB_RESULT",
          id,
          ok: !!tab,
          url: tab?.url ?? "",
          title: tab?.title ?? "",
        });
      } catch (e) {
        nativePort.postMessage({
          type: "ACTIVE_TAB_RESULT",
          id,
          ok: false,
          error: String(e?.message ?? e),
        });
      }
      return;
    }

    if (msg?.type === "LINKEDIN_CREATE_POST") {
      const id = msg.id;
      const text = String(msg.text ?? "").trim();
      const publish = !!msg.publish;
      const feedUrl = "https://www.linkedin.com/feed/";
      try {
        let tab = await pickTab("https://www.linkedin.com/*");
        if (!tab?.id) {
          tab = await chrome.tabs.create({ url: feedUrl, active: true });
          await new Promise((r) => setTimeout(r, 3500));
        } else {
          await focusTab(tab);
          if (!tab.url || !tab.url.includes("/feed")) {
            await chrome.tabs.update(tab.id, { url: feedUrl });
            await new Promise((r) => setTimeout(r, 3200));
          } else {
            await new Promise((r) => setTimeout(r, 800));
          }
        }

        // MAIN world — React/LinkedIn ignores isolated content-script .click()
        const pasteOnly = !!msg.pasteOnly;
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: (t, p, po) => {
            window.__rippleLiArgs = { text: t, publish: p, pasteOnly: po };
          },
          args: [text, publish, pasteOnly],
        });
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          files: ["linkedinMain.js"],
        });
        const result = injected?.[0]?.result ?? { ok: false, error: "LinkedIn script returned nothing" };

        if (!result?.ok) {
          console.warn("[ripple-ext] LinkedIn MAIN failed, trying content script:", result?.error);
          const fallback = await runOnTab(
            tab.id,
            { type: "LINKEDIN_CREATE_POST", text, publish },
            "linkedinContent.js",
          );
          nativePort.postMessage({
            type: "LINKEDIN_RESULT",
            id,
            ok: !!fallback?.ok,
            error: fallback?.error ?? result?.error,
            detail: fallback?.detail ?? result?.detail,
          });
          return;
        }

        nativePort.postMessage({
          type: "LINKEDIN_RESULT",
          id,
          ok: true,
          error: result.error,
          detail: result.detail,
        });
      } catch (e) {
        nativePort.postMessage({
          type: "LINKEDIN_RESULT",
          id,
          ok: false,
          error: String(e?.message ?? e),
        });
      }
      return;
    }

    if (msg?.type === "INSTAGRAM_MESSAGE") {
      const id = msg.id;
      const username = String(msg.username ?? "").trim();
      const text = String(msg.text ?? "").trim();
      const send = !!msg.send;
      const pasteOnly = !!msg.pasteOnly;
      const sendOnly = !!msg.sendOnly;
      const navigateOnly = !!msg.navigateOnly;
      const focusComposer = !!msg.focusComposer;
      try {
        let tab = await pickTab("https://www.instagram.com/*");
        if (!tab?.id) {
          if (pasteOnly) {
            throw new Error("Instagram tab not found — open a DM thread first");
          }
          tab = await chrome.tabs.create({
            url: "https://www.instagram.com/direct/inbox/",
            active: true,
          });
          await new Promise((r) => setTimeout(r, 3200));
        } else {
          await focusTab(tab);
          const url = tab.url ?? "";
          const inThread = /\/direct\/t\//i.test(url);
          const inInbox = /\/direct\/inbox\/?$/i.test(url);
          const onHome = /^https:\/\/(www\.)?instagram\.com\/?$/i.test(url.split("?")[0]);
          if (pasteOnly || inThread) {
            await new Promise((r) => setTimeout(r, 400));
          } else if (onHome || (!inInbox && !inThread && !url.includes("/direct/"))) {
            await chrome.tabs.update(tab.id, { url: "https://www.instagram.com/direct/inbox/" });
            await new Promise((r) => setTimeout(r, 2400));
          } else {
            await new Promise((r) => setTimeout(r, 700));
          }
        }
        const result = await runOnTab(
          tab.id,
          {
            type: "INSTAGRAM_MESSAGE",
            username,
            text,
            send,
            pasteOnly,
            sendOnly,
            navigateOnly,
            focusComposer,
          },
          "instagramContent.js",
        );
        nativePort.postMessage({
          type: "INSTAGRAM_RESULT",
          id,
          ok: !!result?.ok,
          error: result?.error,
          detail: result?.detail,
        });
      } catch (e) {
        nativePort.postMessage({
          type: "INSTAGRAM_RESULT",
          id,
          ok: false,
          error: String(e?.message ?? e),
        });
      }
      return;
    }

    if (msg?.type === "YOUTUBE_PLAY") {
      const query = String(msg.query ?? "").trim();
      const id = msg.id;
      try {
        const activeYt = await chrome.tabs.query({
          active: true,
          currentWindow: true,
          url: "https://www.youtube.com/*",
        });
        const allYt = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
        const tab =
          activeYt[0]?.id && !activeYt[0].discarded
            ? activeYt[0]
            : allYt.find((t) => t.id && !t.discarded) ?? allYt[0];
        if (!tab?.id) {
          // If no youtube tab exists, open results in a new tab.
          const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
          const created = await chrome.tabs.create({ url, active: true });
          await new Promise((r) => setTimeout(r, 900));
          const result = await chrome.tabs.sendMessage(created.id, {
            type: "YOUTUBE_PLAY",
            query,
          });
          nativePort.postMessage({
            type: "YOUTUBE_RESULT",
            id,
            ok: !!result?.ok,
            error: result?.error,
            detail: result?.detail,
          });
          return;
        }

        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        // Navigate to results first (stable).
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        await chrome.tabs.update(tab.id, { url });
        await new Promise((r) => setTimeout(r, 4500));

        // Ensure content script is present (MV3 can unload).
        let result;
        try {
          result = await chrome.tabs.sendMessage(tab.id, { type: "YOUTUBE_PLAY", query });
        } catch (e) {
          const msgText = String(e?.message ?? e);
          if (msgText.includes("Receiving end does not exist")) {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ["youtubeContent.js"],
            });
            await new Promise((r) => setTimeout(r, 500));
            result = await chrome.tabs.sendMessage(tab.id, { type: "YOUTUBE_PLAY", query });
          } else {
            throw e;
          }
        }

        nativePort.postMessage({
          type: "YOUTUBE_RESULT",
          id,
          ok: !!result?.ok,
          error: result?.error,
          detail: result?.detail,
        });
      } catch (e) {
        nativePort.postMessage({
          type: "YOUTUBE_RESULT",
          id,
          ok: false,
          error: String(e?.message ?? e),
        });
      }
      return;
    }

    const activeWa = await chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: "https://web.whatsapp.com/*",
    });
    const allWa = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    const tab =
      activeWa[0]?.id && !activeWa[0].discarded
        ? activeWa[0]
        : allWa.find((t) => t.id && !t.discarded) ?? allWa[0];
    if (!tab?.id) {
      nativePort.postMessage({
        type: "WHATSAPP_RESULT",
        id: msg.id,
        ok: false,
        error: "Open https://web.whatsapp.com in Chrome or Edge first",
      });
      return;
    }

    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      await new Promise((r) => setTimeout(r, 600));

      const result = await runOnWhatsAppTab(tab.id, {
        type: "WHATSAPP_RUN",
        contact: msg.contact,
        text: msg.text,
        send: !!msg.send,
        attachment: msg.attachment,
      });
      nativePort.postMessage({
        type: "WHATSAPP_RESULT",
        id: msg.id,
        ok: !!result?.ok,
        error: result?.error,
        detail: result?.detail,
        logs: result?.logs,
      });
    } catch (e) {
      nativePort.postMessage({
        type: "WHATSAPP_RESULT",
        id: msg.id,
        ok: false,
        error: String(e?.message ?? e),
      });
    }
  });

  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
    const err = chrome.runtime.lastError;
    if (err) {
      console.warn("[ripple-ext] native disconnected:", err.message);
    }
    scheduleReconnect();
  });

  reconnectDelayMs = 3000;
  console.info("[ripple-ext] Native Messaging port open");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "RIPPLE_DOWNLOAD_GMAIL_ATTACHMENT") {
    const fileName = sanitizeFileName(msg.fileName);
    chrome.downloads.download(
      {
        url: msg.url,
        filename: `Ripple/attachments/${fileName}`,
        conflictAction: "uniquify",
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse?.({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        pendingDownloads.set(downloadId, msg);
        sendResponse?.({ ok: true, downloadId });
      },
    );
    return true;
  }

  if (msg?.type !== "RIPPLE_CROSS_APP_INGEST") return;
  if (!nativePort) {
    sendResponse?.({ ok: false, error: "Native port not connected" });
    return true;
  }
  try {
    nativePort.postMessage({
      type: "CROSS_APP_INGEST_PUSH",
      appId: msg.appId,
      summary: msg.summary,
      contact: msg.contact,
      command: msg.command,
      path: msg.path,
      externalUrl: msg.externalUrl,
      attachments: msg.attachments,
    });
    sendResponse?.({ ok: true });
  } catch (e) {
    sendResponse?.({ ok: false, error: String(e?.message ?? e) });
  }
  return true;
});

connectNative();

if (chrome.downloads?.onChanged) {
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state?.current !== "complete" || !nativePort) return;
    const meta = pendingDownloads.get(delta.id);
    if (!meta) return;
    chrome.downloads.search({ id: delta.id }, (items) => {
      const item = items?.[0];
      if (!item?.filename) return;
      pendingDownloads.delete(delta.id);
      try {
        nativePort.postMessage({
          type: "CROSS_APP_INGEST_PUSH",
          appId: meta.appId || "gmail",
          summary: meta.summary || `Attachment: ${meta.fileName}`,
          contact: meta.contact,
          path: item.filename,
          externalUrl: meta.pageUrl,
          attachments: [meta.fileName],
          command: `Gmail attachment: ${meta.fileName}`,
        });
      } catch (e) {
        console.warn("[ripple-ext] attachment ingest failed", e);
      }
    });
  });
}
