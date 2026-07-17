/** P5.3 — generic DOM helpers for any active tab (production browser path). */

function visibleText(el) {
  if (!el) return "";
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript") return "";
  return (el.innerText ?? el.textContent ?? "").trim();
}

function findBySelector(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function findByText(text, partial) {
  const needle = String(text ?? "").trim().toLowerCase();
  if (!needle) return null;
  const nodes = document.querySelectorAll(
    "a,button,input,textarea,[role='button'],[contenteditable='true'],label,span,div,p,h1,h2,h3",
  );
  for (const el of nodes) {
    const t = visibleText(el).toLowerCase();
    if (!t) continue;
    if (partial ? t.includes(needle) : t === needle) return el;
  }
  return null;
}

function findByAria(label) {
  const needle = String(label ?? "").trim().toLowerCase();
  if (!needle) return null;
  const nodes = document.querySelectorAll("[aria-label],[aria-labelledby]");
  for (const el of nodes) {
    const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
    if (aria && (aria === needle || aria.includes(needle))) return el;
  }
  return null;
}

function elementBox(el) {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

function resolveTarget(msg) {
  if (msg.selector) {
    const el = findBySelector(msg.selector);
    if (el) return el;
  }
  if (msg.text) {
    const el =
      findByText(msg.text, msg.partial !== false) ??
      findByAria(msg.text);
    if (el) return el;
  }
  if (msg.ariaLabel) {
    const el = findByAria(msg.ariaLabel);
    if (el) return el;
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "BROWSER_GENERIC") return;

  try {
    const action = msg.action;

    if (action === "extract_text") {
      const max = Math.min(Number(msg.maxChars) || 12000, 50000);
      const root = document.body ?? document.documentElement;
      const text = (root?.innerText ?? "").trim().slice(0, max);
      sendResponse({
        ok: true,
        text,
        url: location.href,
        title: document.title ?? "",
      });
      return true;
    }

    if (action === "find_element") {
      const el = resolveTarget(msg);
      if (!el) {
        sendResponse({ ok: false, error: "element_not_found" });
        return true;
      }
      sendResponse({ ok: true, ...elementBox(el), tag: el.tagName });
      return true;
    }

    if (action === "click") {
      if (typeof msg.x === "number" && typeof msg.y === "number") {
        const target = document.elementFromPoint(msg.x, msg.y);
        if (!target) {
          sendResponse({ ok: false, error: "no_element_at_point" });
          return true;
        }
        target.click();
        sendResponse({ ok: true, detail: `clicked@${msg.x},${msg.y}` });
        return true;
      }
      const el = resolveTarget(msg);
      if (!el) {
        sendResponse({ ok: false, error: "element_not_found" });
        return true;
      }
      el.click();
      sendResponse({ ok: true, detail: "clicked", ...elementBox(el) });
      return true;
    }

    if (action === "type") {
      const text = String(msg.text ?? "");
      if (!text) {
        sendResponse({ ok: false, error: "missing_text" });
        return true;
      }
      const el =
        (msg.selector ? findBySelector(msg.selector) : null) ??
        document.activeElement;
      if (!el) {
        sendResponse({ ok: false, error: "no_focus_target" });
        return true;
      }
      const tag = (el.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el.isContentEditable) {
        el.focus();
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      } else {
        sendResponse({ ok: false, error: "target_not_editable" });
        return true;
      }
      sendResponse({ ok: true, detail: `typed ${text.length} chars` });
      return true;
    }

    if (action === "scroll") {
      const deltaY = Number(msg.deltaY ?? msg.amount ?? 400);
      const el = msg.selector ? findBySelector(msg.selector) : null;
      if (el) {
        el.scrollBy({ top: deltaY, behavior: "smooth" });
      } else {
        window.scrollBy({ top: deltaY, behavior: "smooth" });
      }
      sendResponse({
        ok: true,
        detail: `scrolled ${deltaY}`,
        scrollY: window.scrollY,
      });
      return true;
    }

    sendResponse({ ok: false, error: `unknown_action:${action}` });
  } catch (e) {
    sendResponse({ ok: false, error: String(e?.message ?? e) });
  }
  return true;
});
