// Ripple Instagram DOM helper (MV3 content script)
// { type: "INSTAGRAM_MESSAGE", username: string, text: string, send: boolean, pasteOnly?: boolean }

(function registerRippleInstagramListener() {
  const root = globalThis;
  if (root.__rippleInstagramListenerRegistered) return;
  root.__rippleInstagramListenerRegistered = true;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isVisible(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  function clickEl(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
  }

  function normalizeUser(s) {
    return String(s ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
  }

  function foldName(s) {
    return normalizeUser(s).replace(/[^a-z0-9]/g, "");
  }

  function nameTokens(s) {
    return normalizeUser(s).split(/\s+/).filter((t) => t.length > 1);
  }

  const MATCH_MIN_SCORE = 62;
  const MATCH_AMBIGUITY_GAP = 7;

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  }

  /** mariam ≈ maryam, i/y swaps in names */
  function vowelFold(s) {
    return foldName(s).replace(/y/g, "i");
  }

  /** Typo-tolerant score from folded strings (shaikh ≈ sheikh, mariam ≈ maryam). */
  function fuzzyFoldScore(a, b) {
    const fa = foldName(a);
    const fb = foldName(b);
    if (!fa || !fb) return 0;
    if (fa === fb) return 96;

    const scorePair = (x, y) => {
      if (!x || !y) return 0;
      if (x === y) return 96;
      const dist = levenshtein(x, y);
      const maxLen = Math.max(x.length, y.length);
      if (maxLen < 3) return 0;
      const ratio = 1 - dist / maxLen;
      if (ratio >= 0.88) return Math.round(80 + ratio * 18);
      if (ratio >= 0.75 && maxLen >= 4) return Math.round(68 + ratio * 12);
      if (ratio >= 0.65 && maxLen >= 5) return Math.round(60 + ratio * 10);
      return 0;
    };

    return Math.max(scorePair(fa, fb), scorePair(vowelFold(a), vowelFold(b)));
  }

  /** "Adina Mariam" → prefers "Adina Maryam" over "Adina Isolde Mariam". */
  function scoreOrderedFullName(query, displayName) {
    const qTokens = nameTokens(query);
    const dTokens = nameTokens(displayName);
    if (qTokens.length < 2 || dTokens.length < 1) return 0;

    const first = fuzzyFoldScore(qTokens[0], dTokens[0]);
    const lastQ = qTokens[qTokens.length - 1];
    const lastD = dTokens[dTokens.length - 1];
    const last = fuzzyFoldScore(lastQ, lastD);
    if (first < 68 || last < 68) return 0;

    let score = Math.round((first + last) / 2);
    if (dTokens.length === qTokens.length) score += 10;
    if (dTokens.length > qTokens.length) score -= (dTokens.length - qTokens.length) * 5;
    return Math.min(99, score);
  }

  function scoreNameMatch(query, displayName, handle) {
    const q = normalizeUser(query);
    const d = normalizeUser(displayName);
    const h = normalizeUser(handle).replace(/^@/, "");
    if (!q) return 0;

    let best = 0;
    const bump = (n) => {
      if (n > best) best = n;
    };

    if (q === d || q === h) return 100;
    if (d && (d.includes(q) || q.includes(d))) bump(92);
    if (h && (h.includes(q.replace(/\s+/g, "")) || foldName(q) === foldName(h))) bump(88);

    bump(fuzzyFoldScore(query, displayName));
    bump(fuzzyFoldScore(query, handle));
    bump(fuzzyFoldScore(foldName(query), handle));
    bump(scoreOrderedFullName(query, displayName));

    const qTokens = nameTokens(query);
    const dTokens = nameTokens(displayName);
    if (qTokens.length && dTokens.length) {
      const hits = qTokens.filter((qt) =>
        dTokens.some(
          (dt) =>
            dt.includes(qt) ||
            qt.includes(dt) ||
            fuzzyFoldScore(qt, dt) >= 72,
        ),
      ).length;
      if (hits >= 2) bump(86);
      if (hits === 1 && qTokens.length === 1) bump(80);
      if (hits >= 1 && qTokens.length >= 2) bump(74);

      if (qTokens[0] && dTokens[0]) {
        bump(fuzzyFoldScore(qTokens[0], dTokens[0]));
        if (foldName(qTokens[0]) === foldName(dTokens[0])) bump(83);
      }
      if (qTokens.length >= 2 && dTokens.length >= 2) {
        const lastQ = qTokens[qTokens.length - 1];
        const lastD = dTokens[dTokens.length - 1];
        bump(fuzzyFoldScore(lastQ, lastD));
      }
    }

    const qFold = foldName(query);
    const dFold = foldName(displayName);
    const hFold = foldName(handle);
    if (qFold.length >= 4 && dFold.includes(qFold)) bump(72);
    if (qFold.length >= 4 && hFold.includes(qFold)) bump(70);

    return best;
  }

  function rowMatchScore(query, names) {
    return Math.max(
      scoreNameMatch(query, names.display, names.handle),
      scoreOrderedFullName(query, names.display),
      fuzzyFoldScore(foldName(query), names.handle),
      fuzzyFoldScore(foldName(query), foldName(names.display)),
    );
  }

  function pickBestNameMatch(query, rows, parseNames) {
    const qFold = foldName(query);
    const scored = rows
      .map((row) => {
        const names = parseNames(row);
        const ordered = scoreOrderedFullName(query, names.display);
        const score = rowMatchScore(query, names);
        return { row, names, score, ordered };
      })
      .filter((s) => s.score >= MATCH_MIN_SCORE)
      .sort((a, b) => b.score - a.score || b.ordered - a.ordered);

    if (!scored.length) return null;

    const top = scored[0];
    const second = scored[1];

    if (top.score >= 88 || top.ordered >= 86) return top.row;

    if (second && top.score - second.score < MATCH_AMBIGUITY_GAP) {
      const d0 = foldName(top.names.display);
      const d1 = foldName(second.names.display);
      const dist0 = levenshtein(qFold, d0);
      const dist1 = levenshtein(qFold, d1);
      if (dist0 < dist1) return top.row;
      if (dist0 === dist1 && nameTokens(top.names.display).length <= nameTokens(second.names.display).length) {
        return top.row;
      }
      const h0 = fuzzyFoldScore(qFold, top.names.handle);
      const h1 = fuzzyFoldScore(qFold, second.names.handle);
      if (h0 > h1 + 5) return top.row;
      return null;
    }

    return top.row;
  }

  function findInstagramHighlightedRow(rows) {
    for (const row of rows) {
      if (row.getAttribute("aria-selected") === "true") return row;
      if (row.querySelector?.('[aria-selected="true"]')) return row;
    }
    return null;
  }

  function isDirectThread() {
    return /\/direct\/t\//i.test(location.pathname);
  }

  function isInboxPage() {
    return /\/direct\/inbox\/?$/i.test(location.pathname);
  }

  function isInstagramHome() {
    const p = location.pathname;
    return p === "/" || p === "";
  }

  async function ensureDirectReady() {
    if (!location.hostname.includes("instagram.com")) return;
    if (isDirectThread() || isInboxPage()) return;

    const directLink = document.querySelector(
      'a[href="/direct/inbox/"], a[href*="/direct/inbox"]',
    );
    if (directLink && isVisible(directLink)) {
      clickEl(directLink);
      await sleep(1800);
      return;
    }

    location.href = "https://www.instagram.com/direct/inbox/";
    await sleep(2200);
  }

  function collectInboxThreads() {
    const links = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
    const rows = Array.from(
      document.querySelectorAll('div[role="listbox"] div[role="button"], div[role="button"]'),
    );
    const seen = new Set();
    const out = [];
    for (const el of [...links, ...rows]) {
      if (!isVisible(el) || seen.has(el)) continue;
      const t = (el.textContent || "").trim();
      if (t.length < 2 || t.length > 220) continue;
      if (/^(primary|general|requests|your messages|send a message)$/i.test(t)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function openInboxThread(recipient) {
    const best = pickBestNameMatch(recipient, collectInboxThreads(), (row) =>
      parseNamesFromRow(row),
    );
    if (!best) return false;
    const link = best.closest('a[href*="/direct/t/"]') || best.querySelector?.('a[href*="/direct/t/"]');
    clickEl(link && isVisible(link) ? link : best);
    return true;
  }

  function getThreadHeaderName() {
    const selectors = [
      "header h1 span",
      "header h2 span",
      "[role='main'] header span",
      "header a span",
    ];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const node of nodes) {
        const t = (node.textContent || "").trim();
        if (!t || t.length < 2) continue;
        if (/^(primary|general|requests|instagram|messages|search)$/i.test(t)) continue;
        return t;
      }
    }
    return "";
  }

  function closeNewMessageDialog() {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return;
    const close = dialog.querySelector(
      '[aria-label="Close"], svg[aria-label="Close"]',
    );
    if (!close) return;
    const btn = close.closest("button, div[role='button']") || close;
    if (isVisible(btn)) clickEl(btn);
  }

  function findNewMessageButton() {
    const selectors = [
      'svg[aria-label="New message"]',
      'svg[aria-label="New Message"]',
      'svg[aria-label="New Message"]',
      '[aria-label="New message"]',
      '[aria-label="New Message"]',
      'a[href*="/direct/new/"]',
      'a[href*="/direct/new"]',
    ];
    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        const clickable = el.closest("a, button, div[role='button']") || el;
        if (isVisible(clickable)) return clickable;
      }
    }
    for (const btn of document.querySelectorAll("div[role='button'], button, a")) {
      if (!isVisible(btn)) continue;
      const label = (btn.getAttribute("aria-label") || btn.textContent || "").toLowerCase();
      if (label.includes("new message") || label === "new message") return btn;
    }
    return null;
  }

  function findNewMessageActionButton() {
    const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
    return (
      buttons.find((b) => {
        if (!isVisible(b)) return false;
        const t = (b.textContent || "").trim().toLowerCase();
        return t === "chat" || t === "next" || t === "suivant" || t === "weiter";
      }) ?? null
    );
  }

  async function ensureInboxForSearch() {
    await ensureDirectReady();
    if (isDirectThread()) {
      const back =
        document.querySelector('[aria-label="Back"]')?.closest("button, div[role='button']") ||
        document.querySelector('svg[aria-label="Back"]')?.closest("button, div[role='button']");
      if (back && isVisible(back)) {
        clickEl(back);
        await sleep(1100);
      }
    }
    if (!isInboxPage()) {
      location.href = "https://www.instagram.com/direct/inbox/";
      await sleep(2200);
    }
  }

  async function openNewMessageModal() {
    closeNewMessageDialog();
    await sleep(350);

    let opened = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const btn = findNewMessageButton();
      if (btn) {
        clickEl(btn);
        await sleep(1200);
      }
      for (let i = 0; i < 20; i++) {
        if (findSearchInput()) {
          opened = true;
          break;
        }
        await sleep(200);
      }
      if (opened) break;
      await sleep(400);
    }
    return opened;
  }

  async function clearAndTypeSearch(input, value) {
    const text = String(value ?? "").trim();
    input.scrollIntoView({ block: "nearest" });
    clickEl(input);
    input.focus();
    await sleep(120);

    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
      input.value = "";
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      await sleep(80);
      for (const ch of text) {
        input.value += ch;
        input.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }),
        );
        await sleep(35);
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    try {
      document.execCommand("insertText", false, text);
    } catch {
      input.textContent = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  function findSearchInput() {
    const dialog = document.querySelector('div[role="dialog"]');
    const scope = dialog || document;
    const inputs = Array.from(
      scope.querySelectorAll('input[type="text"], input[name="queryBox"]'),
    );
    return (
      inputs.find((i) => {
        if (!isVisible(i)) return false;
        const ph = (i.getAttribute("placeholder") || "").toLowerCase();
        return ph.includes("search") || ph.includes("username") || ph === "to:";
      }) ?? inputs.find((i) => isVisible(i)) ??
      null
    );
  }

  function findMessageInput() {
    const dialog = document.querySelector('div[role="dialog"]');
    const areas = Array.from(
      document.querySelectorAll(
        'textarea, div[contenteditable="true"][role="textbox"]',
      ),
    );
    return (
      areas.find((a) => {
        if (!isVisible(a)) return false;
        if (dialog && dialog.contains(a)) return false;
        return true;
      }) ?? null
    );
  }

  function findSendButton() {
    const buttons = Array.from(document.querySelectorAll("button, div[role='button']"));
    return (
      buttons.find((b) => {
        if (!isVisible(b)) return false;
        const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
        return label === "send" || label.includes("send message");
      }) ?? null
    );
  }

  function parseRowNames(text) {
    const lines = String(text)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    let display = "";
    let handle = "";
    for (const line of lines) {
      const compact = line.replace(/\s/g, "");
      if (
        !handle &&
        (/^@?[a-z0-9._]+$/i.test(compact) || (line.includes(".") && !line.includes(" ")))
      ) {
        handle = line.replace(/^@/, "");
        continue;
      }
      if (!display && line.length >= 2 && !/^@?[a-z0-9._]+$/i.test(compact)) {
        display = line;
      }
    }
    if (!display) display = lines[0] || "";
    if (!handle) {
      handle =
        lines.find((l) => l.includes(".") && !l.includes(" ")) ||
        lines.find((l) => /^@?[a-z0-9._]+$/i.test(l.replace(/\s/g, ""))) ||
        "";
      handle = handle.replace(/^@/, "");
    }
    return { display, handle };
  }

  function parseNamesFromRow(el) {
    if (!(el instanceof HTMLElement)) return parseRowNames("");
    const spans = Array.from(el.querySelectorAll("span, div"))
      .map((n) => (n.textContent || "").trim())
      .filter((t) => t.length >= 2 && t.length < 80);
    if (spans.length >= 2) {
      const handleHit = spans.find((t) => /^@?[a-z0-9._]+$/i.test(t.replace(/\s/g, "")) && t.includes("."));
      const displayHit = spans.find(
        (t) => t !== handleHit && !/^@?[a-z0-9._]+$/i.test(t.replace(/\s/g, "")),
      );
      if (displayHit) {
        return {
          display: displayHit,
          handle: (handleHit || "").replace(/^@/, ""),
        };
      }
    }
    return parseRowNames(el.textContent || "");
  }

  function collectSuggestionRows() {
    const dialog = document.querySelector('div[role="dialog"]');
    const scope = dialog || document;
    const seen = new Set();
    const out = [];
    const add = (el) => {
      if (!el || !isVisible(el) || seen.has(el)) return;
      const t = (el.textContent || "").trim();
      if (t.length < 2 || t.length > 120) return;
      if (/^(search|to:|no results|couldn't find|suggested|chat|next)$/i.test(t)) return;
      const lineCount = t.split("\n").filter(Boolean).length;
      if (lineCount > 5) return;
      seen.add(el);
      out.push(el);
    };

    if (dialog) {
      for (const el of dialog.querySelectorAll('div[role="button"], div[role="listitem"], div[role="option"]')) {
        add(el);
      }
    }
    for (const el of scope.querySelectorAll(
      'div[role="listbox"] div[role="button"], div[role="listitem"], div[role="option"]',
    )) {
      add(el);
    }
    return out;
  }

  function pickBestUserMatch(query) {
    const rows = collectSuggestionRows();
    const highlighted = findInstagramHighlightedRow(rows);
    if (highlighted) {
      const names = parseNamesFromRow(highlighted);
      if (rowMatchScore(query, names) >= MATCH_MIN_SCORE) return highlighted;
    }
    return pickBestNameMatch(query, rows, (row) => parseNamesFromRow(row));
  }

  async function waitForThreadReady(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (isDirectThread()) return true;
      if (findMessageInput()) return true;
      await sleep(200);
    }
    return isDirectThread() || findMessageInput() != null;
  }

  async function openViaNewMessageModal(recipient) {
    await ensureInboxForSearch();

    const modalOk = await openNewMessageModal();
    if (!modalOk) {
      return { ok: false, error: "Could not open New message — open Instagram Direct inbox and retry" };
    }

    const search = findSearchInput();
    if (!search) {
      return { ok: false, error: "DM search box not found in New message dialog" };
    }

    await clearAndTypeSearch(search, recipient);
    await sleep(900);

    let userHit = null;
    for (let i = 0; i < 40; i++) {
      userHit = pickBestUserMatch(recipient);
      if (userHit) break;
      await sleep(300);
    }

    if (!userHit) {
      return {
        ok: false,
        error: `No close match for "${recipient}" in search — check spelling or pick them manually`,
      };
    }

    const checkbox = userHit.querySelector('[role="checkbox"], input[type="checkbox"]');
    if (checkbox) {
      const box = checkbox.closest('[role="checkbox"]') || checkbox;
      if (isVisible(box)) clickEl(box);
      await sleep(250);
    }

    clickEl(userHit);
    await sleep(700);

    const actionBtn = findNewMessageActionButton();
    if (actionBtn) {
      clickEl(actionBtn);
      await sleep(1200);
    }

    const ready = await waitForThreadReady(8000);
    if (!ready) {
      return {
        ok: false,
        error: `Found "${recipient}" but chat did not open — click Chat manually, then retry`,
      };
    }

    closeNewMessageDialog();
    await sleep(400);
    return { ok: true, detail: `Opened chat with ${recipient}` };
  }

  function getEditableText(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return (el.value ?? "").trim();
    }
    return (el.textContent ?? "").replace(/\u200b/g, "").trim();
  }

  function setEditableText(el, msg) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = msg;
    } else {
      el.textContent = msg;
    }
  }

  function setEditableTextLexical(el, msg) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = msg;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    while (el.firstChild) el.removeChild(el.firstChild);
    const p = document.createElement("p");
    p.textContent = msg;
    el.appendChild(p);
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  /** Wipe Instagram/Lexical composer — DOM + selectAll + delete. */
  async function nuclearClearEditable(el) {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    clickEl(el);
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    try {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      document.execCommand("cut", false, null);
    } catch {
      /* ignore */
    }
    while (el.firstChild) el.removeChild(el.firstChild);
    el.innerHTML = "";
    el.textContent = "";
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
    );
  }

  function normalizeComposerToTarget(el, msg, prior) {
    const target = String(msg ?? "").trim();
    if (!target) return;
    let written = getEditableText(el);
    if (written === target) return;

    if (written.endsWith(target) && written.length > target.length) {
      setEditableTextLexical(el, target);
      return;
    }

    const old = String(prior ?? "").trim();
    if (old && written.startsWith(old) && written.length > old.length) {
      const tail = written.slice(old.length).trim();
      if (tail === target || tail.includes(target.slice(0, Math.min(24, target.length)))) {
        setEditableTextLexical(el, target);
        return;
      }
    }

    if (written.includes(target) && written.length > target.length + 8) {
      setEditableTextLexical(el, target);
    }
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function dedupeEditableText(el, msg) {
    const target = String(msg ?? "").trim();
    if (!target) return;
    let written = getEditableText(el);
    if (written === target) return;
    const doubled = target + target;
    if (written === doubled || written.startsWith(doubled)) {
      setEditableText(el, target);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    const re = new RegExp(`(${escapeRegExp(target)}){2,}`, "gi");
    if (re.test(written)) {
      setEditableText(el, target);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  /** Replace all text in composer — clipboard paste first (Lexical-safe). */
  async function insertTextReplace(el, text) {
    const msg = String(text ?? "").trim();
    const prior = getEditableText(el);

    await nuclearClearEditable(el);
    await sleep(100);
    if (getEditableText(el).length > 0) {
      await nuclearClearEditable(el);
      await sleep(80);
    }

    el.focus();
    clickEl(el);

    let written = "";
    try {
      await navigator.clipboard.writeText(msg);
      document.execCommand("selectAll", false, null);
      await sleep(60);
      document.execCommand("paste");
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await sleep(120);
      written = getEditableText(el);
    } catch {
      /* ignore */
    }

    if (written !== msg) {
      try {
        document.execCommand("insertText", false, msg);
      } catch {
        /* ignore */
      }
      written = getEditableText(el);
    }

    if (written !== msg) {
      setEditableTextLexical(el, msg);
      written = getEditableText(el);
    }

    normalizeComposerToTarget(el, msg, prior);
    dedupeEditableText(el, msg);
    await sleep(60);
  }

  async function typeInto(el, value) {
    el.focus();
    await sleep(100);
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }
    try {
      document.execCommand("insertText", false, value);
    } catch {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  function readComposerText() {
    const composer = findMessageInput();
    if (!composer) return { ok: false, error: "Message box not found" };
    const text = getEditableText(composer);
    return { ok: true, text };
  }

  async function focusComposerOnly() {
    closeNewMessageDialog();
    await sleep(200);
    const composer = await (async () => {
      for (let i = 0; i < 20; i++) {
        const hit = findMessageInput();
        if (hit) return hit;
        await sleep(200);
      }
      return null;
    })();
    if (!composer) {
      return { ok: false, error: "Message box not found — open a chat and click the text field" };
    }
    clickEl(composer);
    composer.focus();
    await sleep(150);
    return { ok: true, detail: "Composer focused" };
  }

  async function clickSendOnly() {
    const sendBtn = findSendButton();
    if (!sendBtn) {
      return { ok: false, error: "Send button not found — type a message first" };
    }
    clickEl(sendBtn);
    await sleep(500);
    return { ok: true, detail: "Message sent" };
  }

  async function pasteIntoOpenComposer(text, send) {
    closeNewMessageDialog();
    await sleep(300);

    const composer = await (async () => {
      for (let i = 0; i < 25; i++) {
        const hit = findMessageInput();
        if (hit) return hit;
        await sleep(200);
      }
      return null;
    })();

    if (!composer) {
      return {
        ok: false,
        error: "Message box not found — open a chat and click the text field",
      };
    }

    await insertTextReplace(composer, text);
    await sleep(200);

    if (!send) {
      return { ok: true, detail: `Draft ready (${text.length} chars)` };
    }

    const sendBtn = findSendButton();
    if (!sendBtn) {
      return { ok: true, detail: `Message filled (${text.length} chars, not sent)` };
    }
    clickEl(sendBtn);
    await sleep(500);
    return { ok: true, detail: `Message sent (${text.length} chars)` };
  }

  async function sendDm(recipient, text, send, options = {}) {
    const target = String(recipient ?? "").trim();
    if (!target) {
      return { ok: false, error: "Recipient name missing" };
    }
    const navigateOnly = !!options.navigateOnly;

    await ensureDirectReady();

    if (isDirectThread()) {
      const headerName = getThreadHeaderName();
      if (headerName && scoreNameMatch(target, headerName, headerName) >= MATCH_MIN_SCORE) {
        if (navigateOnly) return focusComposerOnly();
        return pasteIntoOpenComposer(text, send);
      }
    }

    if (isInboxPage() || location.pathname.includes("/direct")) {
      if (openInboxThread(target)) {
        await sleep(1400);
        const opened = await waitForThreadReady(4000);
        if (opened) {
          if (navigateOnly) return focusComposerOnly();
          return pasteIntoOpenComposer(text, send);
        }
      }
    }

    const viaModal = await openViaNewMessageModal(target);
    if (!viaModal.ok) return viaModal;

    if (navigateOnly) return focusComposerOnly();
    return pasteIntoOpenComposer(text, send);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "INSTAGRAM_READ_COMPOSER") {
      sendResponse(readComposerText());
      return true;
    }
    if (msg?.type === "INSTAGRAM_FOCUS_COMPOSER") {
      focusComposerOnly()
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }
    if (msg?.type !== "INSTAGRAM_MESSAGE") return;

    const username = String(msg.username ?? "").trim();
    const text = String(msg.text ?? "").trim();
    const send = !!msg.send;
    const pasteOnly = !!msg.pasteOnly;
    const sendOnly = !!msg.sendOnly;
    const navigateOnly = !!msg.navigateOnly;
    const focusComposer = !!msg.focusComposer;

    if (sendOnly) {
      clickSendOnly()
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }

    if (focusComposer) {
      focusComposerOnly()
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }

    if (navigateOnly) {
      if (!username) {
        sendResponse({ ok: false, error: "Recipient name missing" });
        return true;
      }
      sendDm(username, "", false, { navigateOnly: true })
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }

    if (!text) {
      sendResponse({ ok: false, error: "Message text missing" });
      return true;
    }
    if (pasteOnly) {
      pasteIntoOpenComposer(text, send)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
      return true;
    }
    if (!username) {
      sendResponse({ ok: false, error: "Recipient name missing" });
      return true;
    }
    sendDm(username, text, send)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  });
})();
