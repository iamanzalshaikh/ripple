/**
 * Runs in page MAIN world (not isolated) so React/LinkedIn hears real clicks.
 * Args set by background: window.__rippleLiArgs = { text, publish }
 */
(async function rippleLinkedInMain() {
  const args = window.__rippleLiArgs || {};
  const postText = String(args.text ?? "").trim();
  const doPublish = !!args.publish;
  const pasteOnly = !!args.pasteOnly;
  const LI_LOG = "[ripple-li-main]";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isVisible = (el) => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.05;
  };

  const label = (el) => {
    const t = (el.textContent || "").trim().toLowerCase();
    return t.length < 120 ? t : "";
  };

  const clickAt = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  };

  const findStartPost = () => {
    window.scrollTo(0, 0);
    const nodes = document.querySelectorAll("div, span, p, button");
    for (const el of nodes) {
      if (!isVisible(el)) continue;
      if (label(el) !== "start a post") continue;
      const r = el.getBoundingClientRect();
      if (r.top > 50 && r.top < window.innerHeight * 0.7) return el;
    }
    return null;
  };

  const findPlaceholder = () => {
    for (const el of document.querySelectorAll("p, span, div")) {
      if (!isVisible(el)) continue;
      const t = label(el);
      if (t.includes("what do you want to talk about")) return el;
    }
    return null;
  };

  const findEditor = () => {
    const ph = findPlaceholder();
    if (ph) clickAt(ph);
    const all = Array.from(
      document.querySelectorAll('[data-lexical-editor="true"], div[contenteditable="true"], .ql-editor'),
    ).filter(isVisible);
    const wide = all.filter((el) => el.getBoundingClientRect().width > 80);
    wide.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });
    return wide[0] ?? all[0] ?? null;
  };

  const waitEditor = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const ed = findEditor();
      if (ed) return ed;
      await sleep(250);
    }
    return null;
  };

  try {
    let editor = await waitEditor(pasteOnly ? 4000 : 1500);

    if (!editor && !pasteOnly) {
      const trigger = findStartPost();
      if (!trigger) {
        return { ok: false, error: "Start a post DIV not found on feed" };
      }
      console.info(LI_LOG, "click Start a post");
      clickAt(trigger);
      await sleep(1500);
      editor = await waitEditor(14000);
    }

    if (!editor && pasteOnly) {
      return {
        ok: false,
        error:
          "Post composer not open — click Start a post, click inside the text box, then say your command again",
      };
    }

    if (!editor) {
      if (findPlaceholder()) {
        return {
          ok: false,
          error: "Composer visible — click in the text box once, then retry voice command",
        };
      }
      return { ok: false, error: "LinkedIn post composer did not open" };
    }

    if (!postText) {
      clickAt(editor);
      editor.focus();
      await sleep(200);
      if (doPublish) {
        const postBtn = Array.from(document.querySelectorAll("button")).find((b) => {
          if (!isVisible(b)) return false;
          return (b.textContent || "").trim().toLowerCase() === "post";
        });
        if (postBtn && !postBtn.disabled) {
          clickAt(postBtn);
          return { ok: true, detail: "LinkedIn post published" };
        }
        return { ok: false, error: "Post button not found — add text first" };
      }
      return { ok: true, detail: "LinkedIn post composer opened" };
    }

    clickAt(editor);
    editor.focus();
    await sleep(300);

    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, postText);
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: postText, inputType: "insertText" }));
    await sleep(400);

    let len = (editor.textContent || "").trim().length;
    if (len < 3) {
      try {
        await navigator.clipboard.writeText(postText);
        document.execCommand("paste");
        await sleep(500);
        len = (editor.textContent || "").trim().length;
      } catch {
        /* ignore */
      }
    }

    if (len < 3) {
      return { ok: false, error: "Composer open but text not inserted" };
    }

    if (!doPublish) {
      return { ok: true, detail: `LinkedIn post drafted (${len} chars)` };
    }

    const postBtn = Array.from(document.querySelectorAll("button")).find((b) => {
      if (!isVisible(b)) return false;
      return (b.textContent || "").trim().toLowerCase() === "post";
    });
    if (postBtn && !postBtn.disabled) {
      clickAt(postBtn);
      return { ok: true, detail: "LinkedIn post published" };
    }
    return { ok: true, detail: `LinkedIn post drafted (${len} chars)` };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  } finally {
    delete window.__rippleLiArgs;
  }
})();
