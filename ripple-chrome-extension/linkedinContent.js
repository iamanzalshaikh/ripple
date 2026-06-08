// Ripple LinkedIn DOM helper (MV3) — tuned for 2025/2026 feed UI
// User feed scan: index 21 = DIV text "Start a post" (no aria-label, hashed classes)

(function registerRippleLinkedInListener() {
  const root = globalThis;
  if (root.__rippleLinkedInListenerRegistered) return;
  root.__rippleLinkedInListenerRegistered = true;

  const LI_LOG = "[ripple-li]";

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function log(step, detail) {
    console.info(`${LI_LOG} ${step}`, detail ?? "");
  }

  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const style = window.getComputedStyle(el);
    return (
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      parseFloat(style.opacity) > 0.05
    );
  }

  /** Leaf / near-leaf text — avoids matching huge parent containers. */
  function elementLabel(el) {
    const kids = Array.from(el.childNodes).filter(
      (n) => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE,
    );
    if (kids.length <= 3) {
      const direct = kids
        .map((n) => (n.textContent || "").trim())
        .join("")
        .trim();
      if (direct) return direct.toLowerCase();
    }
    return (el.textContent || "").trim().toLowerCase();
  }

  function robustClick(el) {
    if (!el) return;
    try {
      el.scrollIntoView({ block: "center", inline: "nearest" });
    } catch {
      /* ignore */
    }
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", base));
      el.dispatchEvent(new MouseEvent("mousedown", base));
      el.dispatchEvent(new PointerEvent("pointerup", base));
      el.dispatchEvent(new MouseEvent("mouseup", base));
    } catch {
      /* ignore */
    }
    if (typeof el.focus === "function") el.focus();
    el.click();
  }

  function scrollFeedToTop() {
    window.scrollTo(0, 0);
    const main = document.querySelector("main, .scaffold-layout__main");
    if (main) main.scrollTop = 0;
  }

  /**
   * Primary trigger — matches real LinkedIn feed:
   * DIV (or span/p) with visible text exactly "Start a post" in upper feed area.
   */
  function findStartPostDiv() {
    scrollFeedToTop();
    const nodes = document.querySelectorAll("div, span, p, button, a");
    const hits = [];
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const label = elementLabel(el);
      if (label !== "start a post") continue;
      const r = el.getBoundingClientRect();
      if (r.top < 60 || r.top > window.innerHeight * 0.65) continue;
      hits.push({ el, area: r.width * r.height, top: r.top });
    }
    hits.sort((a, b) => a.top - b.top || b.area - a.area);
    if (hits[0]) {
      log("trigger", "found DIV text Start a post");
      return hits[0].el;
    }
    return null;
  }

  function findShareBoxTrigger() {
    const byText = findStartPostDiv();
    if (byText) return byText;

    const selectors = [
      ".share-box-feed-entry__closed-share-box",
      'button[aria-label*="Start a post"]',
      ".share-box-feed-entry__trigger",
      '[data-view-name="share-sharebox-focus"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function findComposePlaceholder() {
    const nodes = document.querySelectorAll("p, span, div");
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      const t = elementLabel(el);
      if (t.includes("what do you want to talk about") && t.length < 100) return el;
    }
    return null;
  }

  function isComposeDialogOpen() {
    if (findComposePlaceholder()) return true;
    const postBtn = findPostButton();
    if (postBtn) return true;
    return !!findComposerEditor();
  }

  function findComposerEditor() {
    const ph = findComposePlaceholder();
    if (ph) {
      robustClick(ph);
      let node = ph;
      for (let i = 0; i < 14 && node; i++) {
        const ed = node.querySelector?.(
          '[data-lexical-editor="true"], div[contenteditable="true"], .ql-editor',
        );
        if (ed && isVisible(ed)) return ed;
        if (node.isContentEditable && isVisible(node)) return node;
        node = node.parentElement;
      }
    }

    const all = Array.from(
      document.querySelectorAll(
        '[data-lexical-editor="true"], div[contenteditable="true"], .ql-editor',
      ),
    ).filter(isVisible);

    const inComposer = all.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 60 && r.height > 16 && r.top < window.innerHeight * 0.85;
    });
    inComposer.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return inComposer[0] ?? null;
  }

  function findPostButton() {
    return (
      Array.from(document.querySelectorAll("button")).find((b) => {
        if (!isVisible(b)) return false;
        const label = (b.getAttribute("aria-label") || b.textContent || "")
          .trim()
          .toLowerCase();
        return label === "post" && !label.includes("repost");
      }) ?? null
    );
  }

  async function waitForComposerReady(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const ph = findComposePlaceholder();
      if (ph) robustClick(ph);
      const editor = findComposerEditor();
      if (editor) return editor;
      await sleep(250);
    }
    return null;
  }

  async function openShareComposer() {
    if (isComposeDialogOpen()) {
      log("open", "composer already open");
      const editor = await waitForComposerReady(8000);
      if (editor) return { ok: true, editor };
    }

    let trigger = null;
    for (let i = 0; i < 25; i++) {
      trigger = findShareBoxTrigger();
      if (trigger) break;
      await sleep(250);
    }

    if (!trigger) {
      return { ok: false, error: "Could not find 'Start a post' on LinkedIn feed" };
    }

    log("open", "clicking Start a post");
    robustClick(trigger);
    await sleep(1200);

    let editor = await waitForComposerReady(12000);
    if (editor) {
      log("open", "editor ready");
      return { ok: true, editor };
    }

    if (findComposePlaceholder()) {
      return {
        ok: false,
        error:
          "Composer opened — click inside 'What do you want to talk about?' then try again",
      };
    }

    return { ok: false, error: "LinkedIn post composer did not open" };
  }

  async function insertText(el, text) {
    robustClick(el);
    await sleep(300);
    el.focus();
    await sleep(200);

    const done = () => (el.textContent || "").trim().length >= Math.min(5, text.length);

    try {
      document.execCommand("insertText", false, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      await sleep(400);
      if (done()) return;
    } catch {
      /* fall through */
    }

    try {
      await navigator.clipboard.writeText(text);
      document.execCommand("selectAll", false, null);
      await sleep(80);
      document.execCommand("paste");
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await sleep(500);
      if (done()) return;
    } catch {
      /* fall through */
    }

    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  async function createPost(text, publish) {
    const opened = await openShareComposer();
    if (!opened.ok) return opened;

    if (!text) {
      return { ok: true, detail: "LinkedIn post composer opened" };
    }

    log("insert", `${text.length} chars`);
    await insertText(opened.editor, text);
    await sleep(600);

    const bodyLen = (opened.editor.textContent || "").trim().length;
    if (bodyLen < 3) {
      return { ok: false, error: "Text not inserted — click in composer and retry" };
    }

    if (!publish) {
      return { ok: true, detail: `LinkedIn post drafted (${bodyLen} chars)` };
    }

    const postBtn = findPostButton();
    if (postBtn && !postBtn.disabled) {
      robustClick(postBtn);
      await sleep(800);
      return { ok: true, detail: "LinkedIn post published" };
    }
    return { ok: true, detail: `LinkedIn post drafted (${bodyLen} chars)` };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "LINKEDIN_CREATE_POST") return;
    createPost(String(msg.text ?? "").trim(), !!msg.publish)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });
})();
 