// // // /** WhatsApp Web automation — resilient selectors, fuzzy match, step logs. */

// // // const WA_LOG = "[WA]";
// // // /** Minimum fuzzy score before opening a chat (avoid wrong person). */
// // // const MIN_CONTACT_SCORE = 0.72;
// // // const CHAT_POLL_MS = 200;
// // // /** Final / fallback waits for compose. */
// // // const CHAT_OPEN_TIMEOUT_MS = 8000;
// // // /** Per sidebar click or search open step — fail fast, try next method. */
// // // const COMPOSE_QUICK_MS = 2500;
// // // const SIDEBAR_ATTEMPT_MS = 2000;
// // // const SIDEBAR_MAX_ATTEMPTS = 2;
// // // const SEARCH_HIT_TIMEOUT_MS = 4000;

// // // function waLog(step, detail) {
// // //   console.info(`${WA_LOG} ${step}`, detail ?? "");
// // // }

// // // function sleep(ms) {
// // //   return new Promise((r) => setTimeout(r, ms));
// // // }

// // // function isVisible(el) {
// // //   if (!el || !(el instanceof HTMLElement)) return false;
// // //   const r = el.getBoundingClientRect();
// // //   return r.width > 6 && r.height > 6;
// // // }

// // // async function waitUntil(fn, timeoutMs = 5000, intervalMs = 120) {
// // //   const start = Date.now();
// // //   while (Date.now() - start < timeoutMs) {
// // //     const hit = fn();
// // //     if (hit) return hit;
// // //     await sleep(intervalMs);
// // //   }
// // //   return null;
// // // }

// // // function levenshtein(a, b) {
// // //   const m = a.length;
// // //   const n = b.length;
// // //   const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
// // //   for (let i = 0; i <= m; i++) dp[i][0] = i;
// // //   for (let j = 0; j <= n; j++) dp[0][j] = j;
// // //   for (let i = 1; i <= m; i++) {
// // //     for (let j = 1; j <= n; j++) {
// // //       const cost = a[i - 1] === b[j - 1] ? 0 : 1;
// // //       dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
// // //     }
// // //   }
// // //   return dp[m][n];
// // // }

// // // function normalizeName(s) {
// // //   return (s ?? "")
// // //     .toLowerCase()
// // //     .replace(/[()]/g, " ")
// // //     .replace(/\s+/g, " ")
// // //     .trim();
// // // }

// // // /** Fuzzy: Salik ↔ Saaliq, Ammi ↔ Ammi1, Abhishek work ↔ Abhishek ( Work ) */
// // // function similarity(a, b) {
// // //   a = normalizeName(a);
// // //   b = normalizeName(b);
// // //   if (!a || !b) return 0;
// // //   if (a === b) return 1;
// // //   if (a.includes(b) || b.includes(a)) return 0.85;
// // //   const dist = levenshtein(a, b);
// // //   const maxLen = Math.max(a.length, b.length, 1);
// // //   return Math.max(0, 1 - dist / maxLen);
// // // }

// // // function labelOf(el) {
// // //   return (
// // //     el.getAttribute("aria-label") ??
// // //     el.getAttribute("title") ??
// // //     el.getAttribute("placeholder") ??
// // //     ""
// // //   ).toLowerCase();
// // // }

// // // /** Primary: score sidebar search fields (contenteditable or input). */
// // // function findSearchInput() {
// // //   const candidates = [
// // //     ...document.querySelectorAll(
// // //       '#side div[contenteditable="true"], #side input[type="text"], #side input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]',
// // //     ),
// // //     ...document.querySelectorAll('div[contenteditable="true"]'),
// // //   ];

// // //   let best = null;
// // //   let bestScore = 0;
// // //   const seen = new Set();

// // //   for (const el of candidates) {
// // //     if (seen.has(el) || !isVisible(el)) continue;
// // //     seen.add(el);
// // //     if (el.closest("#main")) continue;

// // //     const label = labelOf(el);
// // //     const inSide = !!el.closest("#side");
// // //     const inHeader = !!el.closest("header");

// // //     let score = 0;
// // //     if (label.includes("search")) score += 60;
// // //     if (label.includes("start a new chat")) score += 55;
// // //     if (label.includes("name or number")) score += 25;
// // //     if (inSide) score += 30;
// // //     if (inHeader) score += 15;
// // //     if (el.getAttribute("role") === "textbox" || el.tagName === "INPUT") score += 15;

// // //     const parentLabel = labelOf(el.parentElement ?? el);
// // //     if (parentLabel.includes("search")) score += 15;

// // //     if (score > bestScore) {
// // //       bestScore = score;
// // //       best = el;
// // //     }
// // //   }

// // //   if (best && bestScore >= 25) {
// // //     waLog("search input scored", { score: bestScore, label: labelOf(best) });
// // //     return best;
// // //   }
// // //   return null;
// // // }

// // // /** Close privacy / intro popups that block search (e.g. "Your chats are private"). */
// // // async function dismissBlockingModals() {
// // //   for (let round = 0; round < 4; round++) {
// // //     let dismissed = false;

// // //     for (const dialog of document.querySelectorAll('[role="dialog"]')) {
// // //       if (!isVisible(dialog)) continue;
// // //       const buttons = dialog.querySelectorAll("button, [role='button']");
// // //       for (const btn of buttons) {
// // //         const t = (btn.textContent ?? "").trim().toLowerCase();
// // //         if (t === "ok" || t === "got it" || t === "continue" || t === "close") {
// // //           btn.click();
// // //           dismissed = true;
// // //           waLog("dismissed dialog", t);
// // //           await sleep(500);
// // //           break;
// // //         }
// // //       }
// // //     }

// // //     document.dispatchEvent(
// // //       new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
// // //     );
// // //     await sleep(200);

// // //     if (!dismissed) break;
// // //   }
// // // }

// // // function isSearchPreviewCompose(el) {
// // //   const label = labelOf(el);
// // //   return /type a message to\b/i.test(label) || label.includes("search");
// // // }

// // // /** Real compose box — not sidebar search or search preview "type a message to X". */
// // // function findComposeFooterInput() {
// // //   const selectors = [
// // //     '#main footer div[contenteditable="true"]',
// // //     '#main footer [contenteditable="true"]',
// // //     '#main div[contenteditable="true"][role="textbox"]',
// // //     '#main [contenteditable="true"][role="textbox"]',
// // //     '#main [aria-label="Type a message"]',
// // //     'footer div[contenteditable="true"][role="textbox"]',
// // //     '[aria-label="Type a message"]',
// // //   ];

// // //   for (const sel of selectors) {
// // //     for (const el of document.querySelectorAll(sel)) {
// // //       if (!isVisible(el) || el.closest("#side")) continue;
// // //       if (isSearchPreviewCompose(el)) continue;
// // //       return el;
// // //     }
// // //   }

// // //   for (const el of document.querySelectorAll('div[contenteditable="true"], [contenteditable="true"]')) {
// // //     if (!isVisible(el) || el.closest("#side")) continue;
// // //     if (isSearchPreviewCompose(el)) continue;
// // //     const label = labelOf(el);
// // //     if (/type a message/i.test(label) && !/type a message to\b/i.test(label)) return el;
// // //     if (el.closest("#main") && el.getAttribute("role") === "textbox") return el;
// // //     const r = el.getBoundingClientRect();
// // //     if (el.closest("#main") && r.top > window.innerHeight * 0.45) return el;
// // //   }
// // //   return null;
// // // }

// // // function findVisibleChatHeader() {
// // //   const header = document.querySelector("#main header");
// // //   return header && isVisible(header) ? header : null;
// // // }

// // // function findConversationPanel() {
// // //   if (isOnDownloadLanding()) return null;
// // //   const selectors = [
// // //     '#main [role="application"]',
// // //     '#main [data-testid="conversation-panel-wrapper"]',
// // //     '#main [data-testid="conversation-panel-body"]',
// // //     '#main .copyable-area',
// // //   ];
// // //   for (const sel of selectors) {
// // //     const el = document.querySelector(sel);
// // //     if (el && isVisible(el) && findVisibleChatHeader()) return el;
// // //   }
// // //   return null;
// // // }

// // // function getMainChatTitle() {
// // //   for (const el of document.querySelectorAll(
// // //     '#main header span[title], #main header span[dir="auto"], #main header h1, #main header h2',
// // //   )) {
// // //     const t = (el.getAttribute("title") ?? el.textContent ?? "").trim();
// // //     if (t && t.length < 120 && !/whatsapp/i.test(t)) return t;
// // //   }
// // //   return "";
// // // }

// // // function isOnDownloadLanding() {
// // //   if (findComposeFooterInput()) return false;
// // //   const main = document.querySelector("#main");
// // //   if (!main) return true;
// // //   const t = (main.innerText ?? "").toLowerCase();
// // //   return (
// // //     t.includes("download whatsapp for windows") ||
// // //     (t.includes("download whatsapp") && !getMainChatTitle())
// // //   );
// // // }

// // // function chatOpenDiagnostics(contact) {
// // //   const compose = findComposeFooterInput();
// // //   waLog("chat open state", {
// // //     contact,
// // //     compose: compose ? labelOf(compose) : null,
// // //     headerTitle: getMainChatTitle() || null,
// // //     hasMainHeader: !!findVisibleChatHeader(),
// // //     hasConversation: !!findConversationPanel(),
// // //     downloadLanding: isOnDownloadLanding(),
// // //   });
// // // }

// // // /** Chat open: visible compose OR (visible header + conversation panel). Title alone is not enough. */
// // // function isChatValidated() {
// // //   if (isOnDownloadLanding()) return false;
// // //   if (findComposeFooterInput()) return true;
// // //   return !!(findVisibleChatHeader() && findConversationPanel());
// // // }

// // // /** Poll until compose input appears (required for typing). */
// // // async function waitForComposeInput(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
// // //   let logged = false;
// // //   const input = await waitUntil(() => {
// // //     if (isOnDownloadLanding()) return null;
// // //     const compose = findComposeFooterInput();
// // //     if (!compose) return null;
// // //     if (!logged) {
// // //       waLog("compose detected", labelOf(compose));
// // //       logged = true;
// // //     }
// // //     return compose;
// // //   }, timeoutMs, CHAT_POLL_MS);
// // //   return input;
// // // }

// // // /** Poll until compose OR header+conversation (sidebar / slow load). */
// // // async function waitForComposeOrConversation(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
// // //   let loggedCompose = false;
// // //   let loggedConversation = false;
// // //   return waitUntil(() => {
// // //     if (isOnDownloadLanding()) return null;
// // //     const compose = findComposeFooterInput();
// // //     if (compose) {
// // //       if (!loggedCompose) {
// // //         waLog("compose detected", labelOf(compose));
// // //         loggedCompose = true;
// // //       }
// // //       return compose;
// // //     }
// // //     if (findVisibleChatHeader() && findConversationPanel()) {
// // //       if (!loggedConversation) {
// // //         waLog("conversation detected");
// // //         loggedConversation = true;
// // //       }
// // //       return "conversation";
// // //     }
// // //     return null;
// // //   }, timeoutMs, CHAT_POLL_MS);
// // // }

// // // async function waitForChatValidated(contact, timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
// // //   let loggedCompose = false;
// // //   let loggedConversation = false;
// // //   const ok = await waitUntil(() => {
// // //     if (isOnDownloadLanding()) return null;
// // //     const compose = findComposeFooterInput();
// // //     if (compose) {
// // //       if (!loggedCompose) {
// // //         waLog("compose detected", labelOf(compose));
// // //         waLog("chat validation passed", "compose");
// // //         loggedCompose = true;
// // //       }
// // //       return true;
// // //     }
// // //     if (findVisibleChatHeader() && findConversationPanel()) {
// // //       if (!loggedConversation) {
// // //         waLog("conversation detected");
// // //         waLog("chat validation passed", "header+conversation");
// // //         loggedConversation = true;
// // //       }
// // //       return true;
// // //     }
// // //     return null;
// // //   }, timeoutMs, CHAT_POLL_MS);
// // //   if (!ok) chatOpenDiagnostics(contact);
// // //   return !!ok;
// // // }

// // // const KEY_META = {
// // //   ArrowDown: { keyCode: 40, code: "ArrowDown" },
// // //   Enter: { keyCode: 13, code: "Enter" },
// // //   Escape: { keyCode: 27, code: "Escape" },
// // // };

// // // function pressKey(el, key) {
// // //   const meta = KEY_META[key] ?? { keyCode: 0, code: key };
// // //   const targets = [el, document.activeElement, document.body].filter(Boolean);
// // //   const seen = new Set();

// // //   for (const target of targets) {
// // //     if (seen.has(target)) continue;
// // //     seen.add(target);
// // //     for (const type of ["keydown", "keypress", "keyup"]) {
// // //       target.dispatchEvent(
// // //         new KeyboardEvent(type, {
// // //           key,
// // //           code: meta.code,
// // //           keyCode: meta.keyCode,
// // //           which: meta.keyCode,
// // //           bubbles: true,
// // //           cancelable: true,
// // //         }),
// // //       );
// // //     }
// // //   }
// // // }

// // // function humanClick(el) {
// // //   if (!el) return false;

// // //   try {
// // //     el.scrollIntoView({ block: "center" });
// // //     const rect = el.getBoundingClientRect();
// // //     const x = rect.left + rect.width / 2;
// // //     const y = rect.top + rect.height / 2;
// // //     const target = document.elementFromPoint(x, y) ?? el;

// // //     const opts = {
// // //       bubbles: true,
// // //       cancelable: true,
// // //       view: window,
// // //       clientX: x,
// // //       clientY: y,
// // //       button: 0,
// // //       buttons: 1,
// // //     };

// // //     target.focus?.();
// // //     for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
// // //       const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
// // //       target.dispatchEvent(new Ctor(type, opts));
// // //     }
// // //     if (typeof target.click === "function") target.click();

// // //     return true;
// // //   } catch (err) {
// // //     waLog("click error", err);
// // //     return false;
// // //   }
// // // }

// // // /** Only the words to send — not the full voice command or contact name. */
// // // function sanitizeMessageText(text) {
// // //   let t = (text ?? "").trim();
// // //   if (!t) return t;

// // //   if (/\bsearch\b/i.test(t) && /\b(?:say|ask)\b/i.test(t)) {
// // //     const m = t.match(/\b(?:say|ask)\s+(.+)$/i);
// // //     if (m?.[1]) t = m[1].trim();
// // //   }

// // //   t = t.replace(/^goodnight\b/i, "good night");
// // //   t = t.replace(/[.,!?]+\s*$/g, "").trim();
// // //   return t;
// // // }

// // // function humanDoubleClick(el) {
// // //   if (!el) return false;
// // //   humanClick(el);
// // //   const rect = el.getBoundingClientRect();
// // //   const x = rect.left + rect.width / 2;
// // //   const y = rect.top + rect.height / 2;
// // //   el.dispatchEvent(
// // //     new MouseEvent("dblclick", {
// // //       bubbles: true,
// // //       cancelable: true,
// // //       clientX: x,
// // //       clientY: y,
// // //       view: window,
// // //     }),
// // //   );
// // //   return humanClick(el);
// // // }

// // // async function blurSearchBox(search) {
// // //   pressKey(search, "Escape");
// // //   await waitForComposeInput(CHAT_OPEN_TIMEOUT_MS);
// // // }

// // // function findMessageInput() {
// // //   const footer = findComposeFooterInput();
// // //   if (footer) {
// // //     waLog("compose footer found", labelOf(footer));
// // //     return footer;
// // //   }
// // //   return null;
// // // }

// // // async function openSearchPanel() {
// // //   for (let i = 0; i < 12; i++) {
// // //     const found = findSearchInput();
// // //     if (found) {
// // //       waLog("search panel open", `attempt ${i + 1}`);
// // //       return found;
// // //     }

// // //     const side = document.querySelector("#side");
// // //     const clickables = side
// // //       ? [
// // //           ...side.querySelectorAll(
// // //             '[data-icon="search"], [data-icon="search-refreshed"], [aria-label="Search"], button, [role="button"]',
// // //           ),
// // //         ]
// // //       : [
// // //           ...document.querySelectorAll(
// // //             '[data-icon="search"], [data-icon="search-refreshed"], [aria-label="Search"]',
// // //           ),
// // //         ];

// // //     for (const node of clickables) {
// // //       const target =
// // //         node.closest("button") ??
// // //         node.closest('[role="button"]') ??
// // //         node.parentElement ??
// // //         node;
// // //       try {
// // //         target.click();
// // //       } catch (_) {
// // //         /* ignore */
// // //       }
// // //     }

// // //     const sideHeader = side?.querySelector("header");
// // //     if (sideHeader) sideHeader.click();

// // //     await sleep(280);
// // //   }

// // //   return findSearchInput();
// // // }

// // // async function focusAndType(el, text) {
// // //   el.scrollIntoView({ block: "nearest", inline: "nearest" });
// // //   el.focus({ preventScroll: true });
// // //   el.click();
// // //   await sleep(250);
// // //   await insertText(el, text);

// // //   const isInput = el instanceof HTMLInputElement;
// // //   const written = (isInput ? el.value : el.textContent ?? "").trim();
// // //   const needle = text.trim().slice(0, Math.min(4, text.length));
// // //   if (needle && !written.toLowerCase().includes(needle.toLowerCase())) {
// // //     throw new Error(`Failed to type "${text}" into field (${labelOf(el) || "unknown"})`);
// // //   }
// // // }

// // // async function insertText(el, text) {
// // //   el.focus();
// // //   el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
// // //   el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));

// // //   try {
// // //     document.execCommand("selectAll", false, null);
// // //     document.execCommand("delete", false, null);
// // //   } catch (_) {
// // //     /* ignore */
// // //   }

// // //   let inserted = false;
// // //   try {
// // //     inserted = document.execCommand("insertText", false, text);
// // //   } catch (_) {
// // //     inserted = false;
// // //   }

// // //   const isInput = el instanceof HTMLInputElement;
// // //   const current = isInput ? el.value : (el.textContent ?? "");
// // //   if (!inserted || !current.includes(text.slice(0, Math.min(4, text.length)))) {
// // //     if (isInput) {
// // //       el.value = text;
// // //     } else {
// // //       const dt = new DataTransfer();
// // //       dt.setData("text/plain", text);
// // //       el.dispatchEvent(
// // //         new ClipboardEvent("paste", {
// // //           clipboardData: dt,
// // //           bubbles: true,
// // //           cancelable: true,
// // //         }),
// // //       );
// // //       if (!(el.textContent ?? "").includes(text.slice(0, 4))) {
// // //         el.textContent = text;
// // //       }
// // //     }
// // //   }

// // //   el.dispatchEvent(
// // //     new InputEvent("input", {
// // //       bubbles: true,
// // //       data: text,
// // //       inputType: "insertText",
// // //     }),
// // //   );
// // // }

// // // function collectContactRows() {
// // //   const rows = [];
// // //   const seen = new Set();

// // //   const add = (el, text) => {
// // //     const t = (text ?? "").trim();
// // //     if (!t || t.length > 80 || seen.has(t.toLowerCase())) return;
// // //     const row = el.closest('[role="listitem"]') ?? el;
// // //     if (!isVisible(row)) return;
// // //     seen.add(t.toLowerCase());
// // //     rows.push({ el: row, text: t });
// // //   };

// // //   for (const item of document.querySelectorAll(
// // //     '#side div[role="listitem"], #side div[role="row"]',
// // //   )) {
// // //     const title =
// // //       item.querySelector("span[title]")?.getAttribute("title") ??
// // //       item.getAttribute("aria-label") ??
// // //       item.textContent?.split("\n")[0];
// // //     add(item, title);
// // //   }

// // //   return rows;
// // // }

// // // function findBestContact(contact) {
// // //   const rows = collectContactRows();
// // //   const scored = rows
// // //     .map((row) => ({
// // //       ...row,
// // //       score: Math.max(
// // //         similarity(contact, row.text),
// // //         similarity(contact, row.text.split(/\s/)[0] ?? ""),
// // //       ),
// // //     }))
// // //     .filter((r) => r.score >= MIN_CONTACT_SCORE)
// // //     .sort((a, b) => b.score - a.score);

// // //   if (scored[0]) {
// // //     waLog("contact ranked", {
// // //       query: contact,
// // //       best: scored[0].text,
// // //       score: scored[0].score.toFixed(2),
// // //       top3: scored.slice(0, 3).map((s) => `${s.text}(${s.score.toFixed(2)})`),
// // //     });
// // //   }
// // //   return scored[0] ?? null;
// // // }

// // // /** Match search results / chat list — uses fuzzy title (Abhishek → Abhishek ( Work )). */
// // // function findClickableContact(contact) {
// // //   let best = null;
// // //   let bestScore = 0;

// // //   const consider = (el, title) => {
// // //     const t = (title ?? "").trim();
// // //     if (!t || t.length > 80) return;
// // //     const score = similarity(contact, t);
// // //     if (score <= bestScore) return;

// // //     const row = el.closest('[role="listitem"]') ?? el.closest('[role="row"]') ?? el;
// // //     if (!isVisible(row)) return;

// // //     bestScore = score;
// // //     const titleSpan = row.querySelector("span[title]") ?? el;
// // //     best = {
// // //       row,
// // //       titleSpan,
// // //       cell: row.querySelector('[role="gridcell"], [data-testid="cell-frame-container"]') ?? row,
// // //       text: t,
// // //       score,
// // //     };
// // //   };

// // //   for (const span of document.querySelectorAll("#side span[title]")) {
// // //     consider(span, span.getAttribute("title"));
// // //   }

// // //   for (const row of document.querySelectorAll('#side [role="listitem"], #side [role="row"]')) {
// // //     if (!isVisible(row)) continue;
// // //     const title =
// // //       row.querySelector("span[title]")?.getAttribute("title") ??
// // //       row.getAttribute("aria-label") ??
// // //       row.textContent?.split("\n")[0];
// // //     consider(row, title);
// // //   }

// // //   if (best) {
// // //     waLog("contact pick", {
// // //       query: contact,
// // //       best: best.text,
// // //       score: best.score.toFixed(2),
// // //     });
// // //   }

// // //   if (best && bestScore >= MIN_CONTACT_SCORE) return best;
// // //   return null;
// // // }

// // // function findSidebarChatRow(contact) {
// // //   const side = document.querySelector("#side");
// // //   if (!side) return null;

// // //   let best = null;
// // //   let bestScore = 0;

// // //   for (const row of side.querySelectorAll('[role="listitem"], [role="row"]')) {
// // //     if (!isVisible(row)) continue;
// // //     const title =
// // //       row.querySelector("span[title]")?.getAttribute("title") ??
// // //       row.getAttribute("aria-label") ??
// // //       row.textContent?.split("\n")[0]?.trim();
// // //     if (!title || title.length > 80) continue;

// // //     const score = similarity(contact, title);
// // //     if (score <= bestScore) continue;

// // //     bestScore = score;
// // //     best = {
// // //       row,
// // //       titleSpan: row.querySelector("span[title]") ?? row,
// // //       text: title,
// // //       score,
// // //     };
// // //   }

// // //   if (best && bestScore >= MIN_CONTACT_SCORE) {
// // //     waLog("sidebar row", { query: contact, best: best.text, score: best.score.toFixed(2) });
// // //     return best;
// // //   }
// // //   return null;
// // // }

// // // async function closeSearchPanel() {
// // //   pressKey(document.body, "Escape");
// // //   await waitUntil(() => !document.activeElement?.closest?.("#side header"), 2000, CHAT_POLL_MS);
// // //   pressKey(document.body, "Escape");
// // // }

// // // async function keyboardSelectSearchResult(search, timeoutMs = COMPOSE_QUICK_MS) {
// // //   search.focus();
// // //   pressKey(search, "ArrowDown");
// // //   pressKey(search, "Enter");
// // //   return waitForComposeInput(timeoutMs);
// // // }

// // // /** Open chat from left chat list — success only when compose box appears (can type). */
// // // async function openContactFromSidebar(contact) {
// // //   if (isOnDownloadLanding()) {
// // //     waLog("sidebar skip", "download landing — search is faster");
// // //     return false;
// // //   }

// // //   await closeSearchPanel();
// // //   await dismissBlockingModals();

// // //   const hit = findSidebarChatRow(contact);
// // //   if (!hit) {
// // //     waLog("sidebar skip", "contact not in chat list");
// // //     return false;
// // //   }

// // //   waLog("opening from sidebar", hit.text);

// // //   for (let attempt = 1; attempt <= SIDEBAR_MAX_ATTEMPTS; attempt++) {
// // //     waLog(`retry click ${attempt}`);
// // //     humanClick(hit.row);
// // //     humanClick(hit.titleSpan);

// // //     const compose = await waitForComposeInput(SIDEBAR_ATTEMPT_MS);
// // //     if (compose) {
// // //       waLog("chat validation passed", "sidebar-compose");
// // //       return true;
// // //     }
// // //   }

// // //   waLog("sidebar failed", "no compose — trying search");
// // //   return false;
// // // }

// // // async function openChatFromSearch(search, contact) {
// // //   const query = contact.trim();

// // //   await focusAndType(search, query);
// // //   waLog("typed contact in search", query);

// // //   const hit = await waitUntil(
// // //     () => findClickableContact(query),
// // //     SEARCH_HIT_TIMEOUT_MS,
// // //     CHAT_POLL_MS,
// // //   );

// // //   if (!hit) {
// // //     throw new Error(
// // //       `No contact found for "${query}" — check the name in WhatsApp search, then retry`,
// // //     );
// // //   }

// // //   assertContactMatch(hit, contact);
// // //   waLog("opening", hit.text);

// // //   const finishIfCompose = async (step, timeoutMs = COMPOSE_QUICK_MS) => {
// // //     let compose = await waitForComposeInput(timeoutMs);
// // //     if (!compose) return false;
// // //     waLog("chat validation passed", step);
// // //     pressKey(search, "Escape");
// // //     compose = await waitForComposeInput(COMPOSE_QUICK_MS);
// // //     return !!compose;
// // //   };

// // //   // A) ArrowDown → Enter
// // //   if (await keyboardSelectSearchResult(search)) {
// // //     if (await finishIfCompose("keyboard")) return;
// // //   }

// // //   // B) Click row
// // //   humanClick(hit.row);
// // //   if (await finishIfCompose("click-row")) return;

// // //   // C) Click title
// // //   humanClick(hit.titleSpan);
// // //   if (await finishIfCompose("click-title")) return;

// // //   // D) Double click row
// // //   humanDoubleClick(hit.row);
// // //   if (await finishIfCompose("double-click-row")) return;

// // //   // E) Escape → retype → ArrowDown → Enter
// // //   waLog("fallback triggered");
// // //   pressKey(search, "Escape");
// // //   await waitUntil(() => findSearchInput(), CHAT_OPEN_TIMEOUT_MS, CHAT_POLL_MS);
// // //   const searchAgain = findSearchInput() ?? search;
// // //   await focusAndType(searchAgain, query);
// // //   await waitUntil(() => findClickableContact(query), SEARCH_HIT_TIMEOUT_MS, CHAT_POLL_MS);
// // //   if (await keyboardSelectSearchResult(searchAgain, CHAT_OPEN_TIMEOUT_MS)) {
// // //     if (await finishIfCompose("fallback-keyboard", CHAT_OPEN_TIMEOUT_MS)) return;
// // //   }

// // //   if (isOnDownloadLanding()) {
// // //     throw new Error(
// // //       `WhatsApp shows "Download for Windows" on the right — click "${contact}" in the left chat list once, then retry Ripple`,
// // //     );
// // //   }

// // //   throw new Error(
// // //     `Chat not opened for "${contact}" — open that chat once manually, then retry`,
// // //   );
// // // }

// // // function assertContactMatch(match, query) {
// // //   if (!match) {
// // //     throw new Error(`No chat found for "${query}"`);
// // //   }
// // //   if (match.score < MIN_CONTACT_SCORE) {
// // //     throw new Error(
// // //       `Low confidence: ${match.text} (${match.score.toFixed(2)}) for "${query}"`,
// // //     );
// // //   }
// // // }

// // // async function waitForWaReady() {
// // //   waLog("waiting for WhatsApp ready");
// // //   const ok = await waitUntil(
// // //     () => document.querySelector("#side") || document.querySelector('[data-icon="search"]'),
// // //     15000,
// // //     200,
// // //   );
// // //   if (!ok) throw new Error("WhatsApp Web not ready — wait for chat list to load");
// // //   waLog("WhatsApp ready");
// // // }

// // // async function searchAndOpen(contact) {
// // //   await waitForWaReady();
// // //   await dismissBlockingModals();

// // //   if (await openContactFromSidebar(contact)) {
// // //     const compose = findComposeFooterInput();
// // //     if (compose) {
// // //       waLog("chat ready (sidebar)", labelOf(compose));
// // //       return;
// // //     }
// // //     waLog("sidebar opened but no compose — continuing to search");
// // //   }

// // //   let search = await openSearchPanel();
// // //   if (!search) {
// // //     search = await waitUntil(() => findSearchInput(), 4000);
// // //   }
// // //   if (!search) {
// // //     throw new Error(
// // //       "Search box not found — dismiss any WhatsApp popup (click OK), refresh web.whatsapp.com, reload extension",
// // //     );
// // //   }

// // //   waLog("search found", labelOf(search));
// // //   waLog("starting search flow", contact);
// // //   await openChatFromSearch(search, contact);
// // //   await dismissBlockingModals();

// // //   const compose = await waitForComposeInput(CHAT_OPEN_TIMEOUT_MS);

// // //   if (!compose) {
// // //     chatOpenDiagnostics(contact);
// // //     if (isOnDownloadLanding()) {
// // //       throw new Error(
// // //         `WhatsApp shows "Download for Windows" on the right — click "${contact}" in the left chat list once, then retry Ripple`,
// // //       );
// // //     }
// // //     throw new Error(`Chat did not open for "${contact}" — open that chat once manually, then retry`);
// // //   }

// // //   waLog("chat ready", labelOf(compose));
// // // }

// // // async function insertMessage(text, send) {
// // //   await dismissBlockingModals();

// // //   const message = sanitizeMessageText(text);
// // //   if (!message) {
// // //     throw new Error("No message text to type (say e.g. 'and say good night')");
// // //   }

// // //   const input =
// // //     (await waitUntil(() => findMessageInput(), 10000, 200)) ?? findMessageInput();
// // //   if (!input) {
// // //     throw new Error(
// // //       "Message box not found — open a chat first (right side should show messages, not Download WhatsApp)",
// // //     );
// // //   }

// // //   waLog("input found", labelOf(input));
// // //   waLog("message to type", message);
// // //   await focusAndType(input, message);
// // //   waLog("message typed", send ? "(will send)" : "(draft)");

// // //   if (send) {
// // //     input.dispatchEvent(
// // //       new KeyboardEvent("keydown", {
// // //         key: "Enter",
// // //         code: "Enter",
// // //         keyCode: 13,
// // //         bubbles: true,
// // //       }),
// // //     );
// // //     waLog("sent");
// // //   } else {
// // //     waLog("draft ready");
// // //   }
// // // }

// // // chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
// // //   if (msg.type !== "WHATSAPP_RUN") return;

// // //   (async () => {
// // //     try {
// // //       waLog("run start", { contact: msg.contact, send: !!msg.send });
// // //       await searchAndOpen(msg.contact);
// // //       await insertMessage(msg.text, msg.send);
// // //       sendResponse({
// // //         ok: true,
// // //         detail: msg.send
// // //           ? `Sent to ${msg.contact}`
// // //           : `Draft for ${msg.contact}`,
// // //       });
// // //     } catch (e) {
// // //       waLog("run failed", e?.message ?? String(e));
// // //       sendResponse({ ok: false, error: e?.message ?? String(e) });
// // //     }
// // //   })();

// // //   return true;
// // // });



// // /** WhatsApp Web automation — resilient selectors, fuzzy match, step logs. */

// const WA_LOG = "[WA]";
// /** Minimum fuzzy score before opening a chat (avoid wrong person). */
// const MIN_CONTACT_SCORE = 0.72;
// const CHAT_POLL_MS = 200;
// /** Final / fallback waits for compose. */
// const CHAT_OPEN_TIMEOUT_MS = 8000;
// /** Per sidebar click or search open step — fail fast, try next method. */
// const COMPOSE_QUICK_MS = 2500;
// const SIDEBAR_ATTEMPT_MS = 2000;
// const SIDEBAR_MAX_ATTEMPTS = 2;
// const SEARCH_HIT_TIMEOUT_MS = 4000;

// function waLog(step, detail) {
//   console.info(`${WA_LOG} ${step}`, detail ?? "");
// }

// function sleep(ms) {
//   return new Promise((r) => setTimeout(r, ms));
// }

// function isVisible(el) {
//   if (!el || !(el instanceof HTMLElement)) return false;
//   const r = el.getBoundingClientRect();
//   return r.width > 6 && r.height > 6;
// }

// async function waitUntil(fn, timeoutMs = 5000, intervalMs = 120) {
//   const start = Date.now();
//   while (Date.now() - start < timeoutMs) {
//     const hit = fn();
//     if (hit) return hit;
//     await sleep(intervalMs);
//   }
//   return null;
// }

// function levenshtein(a, b) {
//   const m = a.length;
//   const n = b.length;
//   const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
//   for (let i = 0; i <= m; i++) dp[i][0] = i;
//   for (let j = 0; j <= n; j++) dp[0][j] = j;
//   for (let i = 1; i <= m; i++) {
//     for (let j = 1; j <= n; j++) {
//       const cost = a[i - 1] === b[j - 1] ? 0 : 1;
//       dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
//     }
//   }
//   return dp[m][n];
// }

// function normalizeName(s) {
//   return (s ?? "")
//     .toLowerCase()
//     .replace(/[()]/g, " ")
//     .replace(/\s+/g, " ")
//     .trim();
// }

// /** Fuzzy: Salik ↔ Saaliq, Ammi ↔ Ammi1, Abhishek work ↔ Abhishek ( Work ) */
// function similarity(a, b) {
//   a = normalizeName(a);
//   b = normalizeName(b);
//   if (!a || !b) return 0;
//   if (a === b) return 1;
//   if (a.includes(b) || b.includes(a)) return 0.85;
//   const dist = levenshtein(a, b);
//   const maxLen = Math.max(a.length, b.length, 1);
//   return Math.max(0, 1 - dist / maxLen);
// }

// function labelOf(el) {
//   return (
//     el.getAttribute("aria-label") ??
//     el.getAttribute("title") ??
//     el.getAttribute("placeholder") ??
//     ""
//   ).toLowerCase();
// }

// /** Primary: score sidebar search fields (contenteditable or input). */
// function findSearchInput() {
//   const candidates = [
//     ...document.querySelectorAll(
//       '#side div[contenteditable="true"], #side input[type="text"], #side input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]',
//     ),
//     ...document.querySelectorAll('div[contenteditable="true"]'),
//   ];

//   let best = null;
//   let bestScore = 0;
//   const seen = new Set();

//   for (const el of candidates) {
//     if (seen.has(el) || !isVisible(el)) continue;
//     seen.add(el);
//     if (el.closest("#main")) continue;

//     const label = labelOf(el);
//     const inSide = !!el.closest("#side");
//     const inHeader = !!el.closest("header");

//     let score = 0;
//     if (label.includes("search")) score += 60;
//     if (label.includes("start a new chat")) score += 55;
//     if (label.includes("name or number")) score += 25;
//     if (inSide) score += 30;
//     if (inHeader) score += 15;
//     if (el.getAttribute("role") === "textbox" || el.tagName === "INPUT") score += 15;

//     const parentLabel = labelOf(el.parentElement ?? el);
//     if (parentLabel.includes("search")) score += 15;

//     if (score > bestScore) {
//       bestScore = score;
//       best = el;
//     }
//   }

//   if (best && bestScore >= 25) {
//     waLog("search input scored", { score: bestScore, label: labelOf(best) });
//     return best;
//   }
//   return null;
// }

// /** Close privacy / intro popups that block search (e.g. "Your chats are private"). */
// async function dismissBlockingModals() {
//   for (let round = 0; round < 4; round++) {
//     let dismissed = false;

//     for (const dialog of document.querySelectorAll('[role="dialog"]')) {
//       if (!isVisible(dialog)) continue;
//       const buttons = dialog.querySelectorAll("button, [role='button']");
//       for (const btn of buttons) {
//         const t = (btn.textContent ?? "").trim().toLowerCase();
//         if (t === "ok" || t === "got it" || t === "continue" || t === "close") {
//           btn.click();
//           dismissed = true;
//           waLog("dismissed dialog", t);
//           await sleep(500);
//           break;
//         }
//       }
//     }

//     document.dispatchEvent(
//       new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }),
//     );
//     await sleep(200);

//     if (!dismissed) break;
//   }
// }

// function isSearchPreviewCompose(el) {
//   const label = labelOf(el);
//   return /type a message to\b/i.test(label) || label.includes("search");
// }

// /** Real compose box — not sidebar search or search preview "type a message to X". */
// function findComposeFooterInput() {
//   const selectors = [
//     '#main footer div[contenteditable="true"]',
//     '#main footer [contenteditable="true"]',
//     '#main div[contenteditable="true"][role="textbox"]',
//     '#main [contenteditable="true"][role="textbox"]',
//     '#main [aria-label="Type a message"]',
//     'footer div[contenteditable="true"][role="textbox"]',
//     '[aria-label="Type a message"]',
//   ];

//   for (const sel of selectors) {
//     for (const el of document.querySelectorAll(sel)) {
//       if (!isVisible(el) || el.closest("#side")) continue;
//       if (isSearchPreviewCompose(el)) continue;
//       return el;
//     }
//   }

//   for (const el of document.querySelectorAll('div[contenteditable="true"], [contenteditable="true"]')) {
//     if (!isVisible(el) || el.closest("#side")) continue;
//     if (isSearchPreviewCompose(el)) continue;
//     const label = labelOf(el);
//     if (/type a message/i.test(label) && !/type a message to\b/i.test(label)) return el;
//     if (el.closest("#main") && el.getAttribute("role") === "textbox") return el;
//     const r = el.getBoundingClientRect();
//     if (el.closest("#main") && r.top > window.innerHeight * 0.45) return el;
//   }
//   return null;
// }

// function findVisibleChatHeader() {
//   const header = document.querySelector("#main header");
//   return header && isVisible(header) ? header : null;
// }

// function findConversationPanel() {
//   if (isOnDownloadLanding()) return null;
//   const selectors = [
//     '#main [role="application"]',
//     '#main [data-testid="conversation-panel-wrapper"]',
//     '#main [data-testid="conversation-panel-body"]',
//     '#main .copyable-area',
//   ];
//   for (const sel of selectors) {
//     const el = document.querySelector(sel);
//     if (el && isVisible(el) && findVisibleChatHeader()) return el;
//   }
//   return null;
// }

// function getMainChatTitle() {
//   for (const el of document.querySelectorAll(
//     '#main header span[title], #main header span[dir="auto"], #main header h1, #main header h2',
//   )) {
//     const t = (el.getAttribute("title") ?? el.textContent ?? "").trim();
//     if (t && t.length < 120 && !/whatsapp/i.test(t)) return t;
//   }
//   return "";
// }

// function isOnDownloadLanding() {
//   if (findComposeFooterInput()) return false;
//   const main = document.querySelector("#main");
//   if (!main) return true;
//   const t = (main.innerText ?? "").toLowerCase();
//   return (
//     t.includes("download whatsapp for windows") ||
//     (t.includes("download whatsapp") && !getMainChatTitle())
//   );
// }

// function chatOpenDiagnostics(contact) {
//   const compose = findComposeFooterInput();
//   waLog("chat open state", {
//     contact,
//     compose: compose ? labelOf(compose) : null,
//     headerTitle: getMainChatTitle() || null,
//     hasMainHeader: !!findVisibleChatHeader(),
//     hasConversation: !!findConversationPanel(),
//     downloadLanding: isOnDownloadLanding(),
//   });
// }

// /** Chat open: visible compose OR (visible header + conversation panel). Title alone is not enough. */
// function isChatValidated() {
//   if (isOnDownloadLanding()) return false;
//   if (findComposeFooterInput()) return true;
//   return !!(findVisibleChatHeader() && findConversationPanel());
// }

// /** Poll until compose input appears (required for typing). */
// async function waitForComposeInput(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
//   let logged = false;
//   const input = await waitUntil(() => {
//     if (isOnDownloadLanding()) return null;
//     const compose = findComposeFooterInput();
//     if (!compose) return null;
//     if (!logged) {
//       waLog("compose detected", labelOf(compose));
//       logged = true;
//     }
//     return compose;
//   }, timeoutMs, CHAT_POLL_MS);
//   return input;
// }

// /** Poll until compose OR header+conversation (sidebar / slow load). */
// async function waitForComposeOrConversation(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
//   let loggedCompose = false;
//   let loggedConversation = false;
//   return waitUntil(() => {
//     if (isOnDownloadLanding()) return null;
//     const compose = findComposeFooterInput();
//     if (compose) {
//       if (!loggedCompose) {
//         waLog("compose detected", labelOf(compose));
//         loggedCompose = true;
//       }
//       return compose;
//     }
//     if (findVisibleChatHeader() && findConversationPanel()) {
//       if (!loggedConversation) {
//         waLog("conversation detected");
//         loggedConversation = true;
//       }
//       return "conversation";
//     }
//     return null;
//   }, timeoutMs, CHAT_POLL_MS);
// }

// async function waitForChatValidated(contact, timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
//   let loggedCompose = false;
//   let loggedConversation = false;
//   const ok = await waitUntil(() => {
//     if (isOnDownloadLanding()) return null;
//     const compose = findComposeFooterInput();
//     if (compose) {
//       if (!loggedCompose) {
//         waLog("compose detected", labelOf(compose));
//         waLog("chat validation passed", "compose");
//         loggedCompose = true;
//       }
//       return true;
//     }
//     if (findVisibleChatHeader() && findConversationPanel()) {
//       if (!loggedConversation) {
//         waLog("conversation detected");
//         waLog("chat validation passed", "header+conversation");
//         loggedConversation = true;
//       }
//       return true;
//     }
//     return null;
//   }, timeoutMs, CHAT_POLL_MS);
//   if (!ok) chatOpenDiagnostics(contact);
//   return !!ok;
// }

// const KEY_META = {
//   ArrowDown: { keyCode: 40, code: "ArrowDown" },
//   Enter: { keyCode: 13, code: "Enter" },
//   Escape: { keyCode: 27, code: "Escape" },
// };

// function pressKey(el, key) {
//   const meta = KEY_META[key] ?? { keyCode: 0, code: key };
//   const targets = [el, document.activeElement, document.body].filter(Boolean);
//   const seen = new Set();

//   for (const target of targets) {
//     if (seen.has(target)) continue;
//     seen.add(target);
//     for (const type of ["keydown", "keypress", "keyup"]) {
//       target.dispatchEvent(
//         new KeyboardEvent(type, {
//           key,
//           code: meta.code,
//           keyCode: meta.keyCode,
//           which: meta.keyCode,
//           bubbles: true,
//           cancelable: true,
//         }),
//       );
//     }
//   }
// }

// function humanClick(el) {
//   if (!el) return false;

//   try {
//     el.scrollIntoView({ block: "center" });
//     const rect = el.getBoundingClientRect();
//     const x = rect.left + rect.width / 2;
//     const y = rect.top + rect.height / 2;
//     const target = document.elementFromPoint(x, y) ?? el;

//     const opts = {
//       bubbles: true,
//       cancelable: true,
//       view: window,
//       clientX: x,
//       clientY: y,
//       button: 0,
//       buttons: 1,
//     };

//     target.focus?.();
//     for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
//       const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
//       target.dispatchEvent(new Ctor(type, opts));
//     }
//     if (typeof target.click === "function") target.click();

//     return true;
//   } catch (err) {
//     waLog("click error", err);
//     return false;
//   }
// }

// /** Only the words to send — not the full voice command or contact name. */
// function sanitizeMessageText(text) {
//   let t = (text ?? "").trim();
//   if (!t) return t;

//   if (/\bsearch\b/i.test(t) && /\b(?:say|ask)\b/i.test(t)) {
//     const m = t.match(/\b(?:say|ask)\s+(.+)$/i);
//     if (m?.[1]) t = m[1].trim();
//   }

//   t = t.replace(/^goodnight\b/i, "good night");
//   t = t.replace(/[.,!?]+\s*$/g, "").trim();
//   return t;
// }

// function humanDoubleClick(el) {
//   if (!el) return false;
//   humanClick(el);
//   const rect = el.getBoundingClientRect();
//   const x = rect.left + rect.width / 2;
//   const y = rect.top + rect.height / 2;
//   el.dispatchEvent(
//     new MouseEvent("dblclick", {
//       bubbles: true,
//       cancelable: true,
//       clientX: x,
//       clientY: y,
//       view: window,
//     }),
//   );
//   return humanClick(el);
// }

// async function blurSearchBox(search) {
//   pressKey(search, "Escape");
//   await waitForComposeInput(CHAT_OPEN_TIMEOUT_MS);
// }

// function findMessageInput() {
//   const footer = findComposeFooterInput();
//   if (footer) {
//     waLog("compose footer found", labelOf(footer));
//     return footer;
//   }
//   return null;
// }

// async function openSearchPanel() {
//   for (let i = 0; i < 12; i++) {
//     const found = findSearchInput();
//     if (found) {
//       waLog("search panel open", `attempt ${i + 1}`);
//       return found;
//     }

//     const side = document.querySelector("#side");
//     const clickables = side
//       ? [
//           ...side.querySelectorAll(
//             '[data-icon="search"], [data-icon="search-refreshed"], [aria-label="Search"], button, [role="button"]',
//           ),
//         ]
//       : [
//           ...document.querySelectorAll(
//             '[data-icon="search"], [data-icon="search-refreshed"], [aria-label="Search"]',
//           ),
//         ];

//     for (const node of clickables) {
//       const target =
//         node.closest("button") ??
//         node.closest('[role="button"]') ??
//         node.parentElement ??
//         node;
//       try {
//         target.click();
//       } catch (_) {
//         /* ignore */
//       }
//     }

//     const sideHeader = side?.querySelector("header");
//     if (sideHeader) sideHeader.click();

//     await sleep(280);
//   }

//   return findSearchInput();
// }

// async function focusAndType(el, text) {
//   el.scrollIntoView({ block: "nearest", inline: "nearest" });
//   el.focus({ preventScroll: true });
//   el.click();
//   await sleep(250);
//   await insertText(el, text);

//   const isInput = el instanceof HTMLInputElement;
//   const written = (isInput ? el.value : el.textContent ?? "").trim();
//   const needle = text.trim().slice(0, Math.min(4, text.length));
//   if (needle && !written.toLowerCase().includes(needle.toLowerCase())) {
//     throw new Error(`Failed to type "${text}" into field (${labelOf(el) || "unknown"})`);
//   }
// }

// async function insertText(el, text) {
//   el.focus();
//   el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
//   el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));

//   try {
//     document.execCommand("selectAll", false, null);
//     document.execCommand("delete", false, null);
//   } catch (_) {
//     /* ignore */
//   }

//   let inserted = false;
//   try {
//     inserted = document.execCommand("insertText", false, text);
//   } catch (_) {
//     inserted = false;
//   }

//   const isInput = el instanceof HTMLInputElement;
//   const current = isInput ? el.value : (el.textContent ?? "");
//   if (!inserted || !current.includes(text.slice(0, Math.min(4, text.length)))) {
//     if (isInput) {
//       el.value = text;
//     } else {
//       const dt = new DataTransfer();
//       dt.setData("text/plain", text);
//       el.dispatchEvent(
//         new ClipboardEvent("paste", {
//           clipboardData: dt,
//           bubbles: true,
//           cancelable: true,
//         }),
//       );
//       if (!(el.textContent ?? "").includes(text.slice(0, 4))) {
//         el.textContent = text;
//       }
//     }
//   }

//   el.dispatchEvent(
//     new InputEvent("input", {
//       bubbles: true,
//       data: text,
//       inputType: "insertText",
//     }),
//   );
// }

// function collectContactRows() {
//   const rows = [];
//   const seen = new Set();

//   const add = (el, text) => {
//     const t = (text ?? "").trim();
//     if (!t || t.length > 80 || seen.has(t.toLowerCase())) return;
//     const row = el.closest('[role="listitem"]') ?? el;
//     if (!isVisible(row)) return;
//     seen.add(t.toLowerCase());
//     rows.push({ el: row, text: t });
//   };

//   for (const item of document.querySelectorAll(
//     '#side div[role="listitem"], #side div[role="row"]',
//   )) {
//     const title =
//       item.querySelector("span[title]")?.getAttribute("title") ??
//       item.getAttribute("aria-label") ??
//       item.textContent?.split("\n")[0];
//     add(item, title);
//   }

//   return rows;
// }

// function findBestContact(contact) {
//   const rows = collectContactRows();
//   const scored = rows
//     .map((row) => ({
//       ...row,
//       score: Math.max(
//         similarity(contact, row.text),
//         similarity(contact, row.text.split(/\s/)[0] ?? ""),
//       ),
//     }))
//     .filter((r) => r.score >= MIN_CONTACT_SCORE)
//     .sort((a, b) => b.score - a.score);

//   if (scored[0]) {
//     waLog("contact ranked", {
//       query: contact,
//       best: scored[0].text,
//       score: scored[0].score.toFixed(2),
//       top3: scored.slice(0, 3).map((s) => `${s.text}(${s.score.toFixed(2)})`),
//     });
//   }
//   return scored[0] ?? null;
// }

// /** Match search results / chat list — uses fuzzy title (Abhishek → Abhishek ( Work )). */
// function findClickableContact(contact) {
//   let best = null;
//   let bestScore = 0;

//   const consider = (el, title) => {
//     const t = (title ?? "").trim();
//     if (!t || t.length > 80) return;
//     const score = similarity(contact, t);
//     if (score <= bestScore) return;

//     const row = el.closest('[role="listitem"]') ?? el.closest('[role="row"]') ?? el;
//     if (!isVisible(row)) return;

//     bestScore = score;
//     const titleSpan = row.querySelector("span[title]") ?? el;
//     best = {
//       row,
//       titleSpan,
//       cell: row.querySelector('[role="gridcell"], [data-testid="cell-frame-container"]') ?? row,
//       text: t,
//       score,
//     };
//   };

//   for (const span of document.querySelectorAll("#side span[title]")) {
//     consider(span, span.getAttribute("title"));
//   }

//   for (const row of document.querySelectorAll('#side [role="listitem"], #side [role="row"]')) {
//     if (!isVisible(row)) continue;
//     const title =
//       row.querySelector("span[title]")?.getAttribute("title") ??
//       row.getAttribute("aria-label") ??
//       row.textContent?.split("\n")[0];
//     consider(row, title);
//   }

//   if (best) {
//     waLog("contact pick", {
//       query: contact,
//       best: best.text,
//       score: best.score.toFixed(2),
//     });
//   }

//   if (best && bestScore >= MIN_CONTACT_SCORE) return best;
//   return null;
// }

// function findSidebarChatRow(contact) {
//   const side = document.querySelector("#side");
//   if (!side) return null;

//   let best = null;
//   let bestScore = 0;

//   for (const row of side.querySelectorAll('[role="listitem"], [role="row"]')) {
//     if (!isVisible(row)) continue;
//     const title =
//       row.querySelector("span[title]")?.getAttribute("title") ??
//       row.getAttribute("aria-label") ??
//       row.textContent?.split("\n")[0]?.trim();
//     if (!title || title.length > 80) continue;

//     const score = similarity(contact, title);
//     if (score <= bestScore) continue;

//     bestScore = score;
//     best = {
//       row,
//       titleSpan: row.querySelector("span[title]") ?? row,
//       text: title,
//       score,
//     };
//   }

//   if (best && bestScore >= MIN_CONTACT_SCORE) {
//     waLog("sidebar row", { query: contact, best: best.text, score: best.score.toFixed(2) });
//     return best;
//   }
//   return null;
// }

// async function closeSearchPanel() {
//   pressKey(document.body, "Escape");
//   await waitUntil(() => !document.activeElement?.closest?.("#side header"), 2000, CHAT_POLL_MS);
//   pressKey(document.body, "Escape");
// }

// async function keyboardSelectSearchResult(search, timeoutMs = COMPOSE_QUICK_MS) {
//   search.focus();
//   pressKey(search, "ArrowDown");
//   pressKey(search, "Enter");
//   return waitForComposeInput(timeoutMs);
// }

// /** Open chat from left chat list — success only when compose box appears (can type). */
// async function openContactFromSidebar(contact) {
//   if (isOnDownloadLanding()) {
//     waLog("sidebar skip", "download landing — search is faster");
//     return false;
//   }

//   await closeSearchPanel();
//   await dismissBlockingModals();

//   const hit = findSidebarChatRow(contact);
//   if (!hit) {
//     waLog("sidebar skip", "contact not in chat list");
//     return false;
//   }

//   waLog("opening from sidebar", hit.text);

//   for (let attempt = 1; attempt <= SIDEBAR_MAX_ATTEMPTS; attempt++) {
//     waLog(`retry click ${attempt}`);
//     humanClick(hit.row);
//     humanClick(hit.titleSpan);

//     const compose = await waitForComposeInput(SIDEBAR_ATTEMPT_MS);
//     if (compose) {
//       waLog("chat validation passed", "sidebar-compose");
//       return true;
//     }
//   }

//   waLog("sidebar failed", "no compose — trying search");
//   return false;
// }

// async function openChatFromSearch(search, contact) {
//   const query = contact.trim();

//   await focusAndType(search, query);
//   waLog("typed contact in search", query);

//   const hit = await waitUntil(
//     () => findClickableContact(query),
//     SEARCH_HIT_TIMEOUT_MS,
//     CHAT_POLL_MS,
//   );

//   if (!hit) {
//     throw new Error(
//       `No contact found for "${query}" — check the name in WhatsApp search, then retry`,
//     );
//   }

//   assertContactMatch(hit, contact);
//   waLog("opening", hit.text);

//   const finishIfCompose = async (step, timeoutMs = CHAT_OPEN_TIMEOUT_MS) => {
//     let compose = await waitForComposeInput(timeoutMs);
//     if (!compose) return false;
//     waLog("chat validation passed", step);
//     pressKey(search, "Escape");
//     compose = await waitForComposeInput(COMPOSE_QUICK_MS);
//     return !!compose;
//   };

//   // ✅ FIX: Pass CHAT_OPEN_TIMEOUT_MS (8000ms) instead of default COMPOSE_QUICK_MS (2500ms)
//   // A) ArrowDown → Enter
//   if (await keyboardSelectSearchResult(search, CHAT_OPEN_TIMEOUT_MS)) {
//     if (await finishIfCompose("keyboard", CHAT_OPEN_TIMEOUT_MS)) return;
//   }

//   // B) Click row
//   humanClick(hit.row);
//   if (await finishIfCompose("click-row", CHAT_OPEN_TIMEOUT_MS)) return;

//   // C) Click title
//   humanClick(hit.titleSpan);
//   if (await finishIfCompose("click-title", CHAT_OPEN_TIMEOUT_MS)) return;

//   // D) Double click row
//   humanDoubleClick(hit.row);
//   if (await finishIfCompose("double-click-row", CHAT_OPEN_TIMEOUT_MS)) return;

//   // E) Escape → retype → ArrowDown → Enter
//   waLog("fallback triggered");
//   pressKey(search, "Escape");
//   await waitUntil(() => findSearchInput(), CHAT_OPEN_TIMEOUT_MS, CHAT_POLL_MS);
//   const searchAgain = findSearchInput() ?? search;
//   await focusAndType(searchAgain, query);
//   await waitUntil(() => findClickableContact(query), SEARCH_HIT_TIMEOUT_MS, CHAT_POLL_MS);
//   if (await keyboardSelectSearchResult(searchAgain, CHAT_OPEN_TIMEOUT_MS)) {
//     if (await finishIfCompose("fallback-keyboard", CHAT_OPEN_TIMEOUT_MS)) return;
//   }

//   if (isOnDownloadLanding()) {
//     throw new Error(
//       `WhatsApp shows "Download for Windows" on the right — click "${contact}" in the left chat list once, then retry Ripple`,
//     );
//   }

//   throw new Error(
//     `Chat not opened for "${contact}" — open that chat once manually, then retry`,
//   );
// }

// function assertContactMatch(match, query) {
//   if (!match) {
//     throw new Error(`No chat found for "${query}"`);
//   }
//   if (match.score < MIN_CONTACT_SCORE) {
//     throw new Error(
//       `Low confidence: ${match.text} (${match.score.toFixed(2)}) for "${query}"`,
//     );
//   }
// }

// async function waitForWaReady() {
//   waLog("waiting for WhatsApp ready");
//   const ok = await waitUntil(
//     () => document.querySelector("#side") || document.querySelector('[data-icon="search"]'),
//     15000,
//     200,
//   );
//   if (!ok) throw new Error("WhatsApp Web not ready — wait for chat list to load");
//   waLog("WhatsApp ready");
// }

// async function searchAndOpen(contact) {
//   await waitForWaReady();
//   await dismissBlockingModals();

//   if (await openContactFromSidebar(contact)) {
//     const compose = findComposeFooterInput();
//     if (compose) {
//       waLog("chat ready (sidebar)", labelOf(compose));
//       return;
//     }
//     waLog("sidebar opened but no compose — continuing to search");
//   }

//   let search = await openSearchPanel();
//   if (!search) {
//     search = await waitUntil(() => findSearchInput(), 4000);
//   }
//   if (!search) {
//     throw new Error(
//       "Search box not found — dismiss any WhatsApp popup (click OK), refresh web.whatsapp.com, reload extension",
//     );
//   }

//   waLog("search found", labelOf(search));
//   waLog("starting search flow", contact);
//   await openChatFromSearch(search, contact);
//   await dismissBlockingModals();

//   const compose = await waitForComposeInput(CHAT_OPEN_TIMEOUT_MS);

//   if (!compose) {
//     chatOpenDiagnostics(contact);
//     if (isOnDownloadLanding()) {
//       throw new Error(
//         `WhatsApp shows "Download for Windows" on the right — click "${contact}" in the left chat list once, then retry Ripple`,
//       );
//     }
//     throw new Error(`Chat did not open for "${contact}" — open that chat once manually, then retry`);
//   }

//   waLog("chat ready", labelOf(compose));
// }

// async function insertMessage(text, send) {
//   await dismissBlockingModals();

//   const message = sanitizeMessageText(text);
//   if (!message) {
//     throw new Error("No message text to type (say e.g. 'and say good night')");
//   }

//   const input =
//     (await waitUntil(() => findMessageInput(), 10000, 200)) ?? findMessageInput();
//   if (!input) {
//     throw new Error(
//       "Message box not found — open a chat first (right side should show messages, not Download WhatsApp)",
//     );
//   }

//   waLog("input found", labelOf(input));
//   waLog("message to type", message);
//   await focusAndType(input, message);
//   waLog("message typed", send ? "(will send)" : "(draft)");

//   if (send) {
//     input.dispatchEvent(
//       new KeyboardEvent("keydown", {
//         key: "Enter",
//         code: "Enter",
//         keyCode: 13,
//         bubbles: true,
//       }),
//     );
//     waLog("sent");
//   } else {
//     waLog("draft ready");
//   }
// }

// chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
//   if (msg.type !== "WHATSAPP_RUN") return;

//   (async () => {
//     try {
//       waLog("run start", { contact: msg.contact, send: !!msg.send });
//       await searchAndOpen(msg.contact);
//       await insertMessage(msg.text, msg.send);
//       sendResponse({
//         ok: true,
//         detail: msg.send
//           ? `Sent to ${msg.contact}`
//           : `Draft for ${msg.contact}`,
//       });
//     } catch (e) {
//       waLog("run failed", e?.message ?? String(e));
//       sendResponse({ ok: false, error: e?.message ?? String(e) });
//     }
//   })();

//   return true;
// });



// /** WhatsApp Web automation — resilient selectors, fuzzy match, step logs. */

const WA_LOG = "[WA]";
/** Minimum fuzzy score before opening a chat (avoid wrong person). */
const MIN_CONTACT_SCORE = 0.72;
const CHAT_POLL_MS = 200;
/** Final / fallback waits for compose. */
const CHAT_OPEN_TIMEOUT_MS = 8000;
/** Per sidebar click or search open step — fail fast, try next method. */
const COMPOSE_QUICK_MS = 2500;
const SIDEBAR_ATTEMPT_MS = 2000;
const SIDEBAR_MAX_ATTEMPTS = 2;
const SEARCH_HIT_TIMEOUT_MS = 4000;

function waLog(step, detail) {
  console.info(`${WA_LOG} ${step}`, detail ?? "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isVisible(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 6 && r.height > 6;
}

async function waitUntil(fn, timeoutMs = 5000, intervalMs = 120) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = fn();
    if (hit) return hit;
    await sleep(intervalMs);
  }
  return null;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
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

function normalizeName(s) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fuzzy: Salik ↔ Saaliq, Ammi ↔ Ammi1, Abhishek work ↔ Abhishek ( Work ) */
function similarity(a, b) {
  a = normalizeName(a);
  b = normalizeName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  return Math.max(0, 1 - dist / maxLen);
}

function labelOf(el) {
  return (
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    el.getAttribute("placeholder") ??
    ""
  ).toLowerCase();
}

/** Primary: score sidebar search fields (contenteditable or input). */
function findSearchInput() {
  const candidates = [
    ...document.querySelectorAll(
      '#side div[contenteditable="true"], #side input[type="text"], #side input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]',
    ),
    ...document.querySelectorAll('div[contenteditable="true"]'),
  ];

  let best = null;
  let bestScore = 0;
  const seen = new Set();

  for (const el of candidates) {
    if (seen.has(el) || !isVisible(el)) continue;
    seen.add(el);
    if (el.closest("#main")) continue;

    const label = labelOf(el);
    const inSide = !!el.closest("#side");
    const inHeader = !!el.closest("header");

    let score = 0;
    if (label.includes("search")) score += 60;
    if (label.includes("start a new chat")) score += 55;
    if (label.includes("name or number")) score += 25;
    if (inSide) score += 30;
    if (inHeader) score += 15;
    if (el.getAttribute("role") === "textbox" || el.tagName === "INPUT") score += 15;

    const parentLabel = labelOf(el.parentElement ?? el);
    if (parentLabel.includes("search")) score += 15;

    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best && bestScore >= 25) {
    waLog("search input scored", { score: bestScore, label: labelOf(best) });
    return best;
  }
  return null;
}

/** Close privacy / intro popups that block search (e.g. "Your chats are private"). */
async function dismissBlockingModals() {
  for (let round = 0; round < 4; round++) {
    let dismissed = false;

    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!isVisible(dialog)) continue;
      const buttons = dialog.querySelectorAll("button, [role='button']");
      for (const btn of buttons) {
        const t = (btn.textContent ?? "").trim().toLowerCase();
        if (t === "ok" || t === "got it" || t === "continue" || t === "close") {
          btn.click();
          dismissed = true;
          waLog("dismissed dialog", t);
          await sleep(500);
          break;
        }
      }
    }

    if (!dismissed) break;
  }
}

function isSearchPreviewCompose(el) {
  const label = labelOf(el);
  // Only reject sidebar search boxes — NEVER reject real compose in #main footer.
  // "type a message to X" appears on real group AND DM compose boxes, so we cannot
  // use it as a rejection signal. The real signal is location: #side vs #main.
  if (el.closest("#side")) return true;
  if (label === "search" || label.startsWith("search or start") || label.startsWith("search messages")) return true;
  return false;
}

/** Real compose box — not sidebar search or search preview "type a message to X". */
function findComposeFooterInput() {
  const selectors = [
    '#main footer div[contenteditable="true"]',
    '#main footer [contenteditable="true"]',
    '#main div[contenteditable="true"][role="textbox"]',
    '#main [contenteditable="true"][role="textbox"]',
    '#main [aria-label="Type a message"]',
    'footer div[contenteditable="true"][role="textbox"]',
    '[aria-label="Type a message"]',
  ];

  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (!isVisible(el) || el.closest("#side")) continue;
      // Footer elements in #main are always real compose — skip preview check
      return el;
    }
  }

  for (const el of document.querySelectorAll('div[contenteditable="true"], [contenteditable="true"]')) {
    if (!isVisible(el) || el.closest("#side")) continue;
    if (isSearchPreviewCompose(el)) continue;
    const label = labelOf(el);
    if (/type a message/i.test(label) && !/type a message to\b/i.test(label)) return el;
    if (el.closest("#main") && el.getAttribute("role") === "textbox") return el;
    const r = el.getBoundingClientRect();
    if (el.closest("#main") && r.top > window.innerHeight * 0.45) return el;
  }
  return null;
}

function findVisibleChatHeader() {
  const header = document.querySelector("#main header");
  return header && isVisible(header) ? header : null;
}

function findConversationPanel() {
  if (isOnDownloadLanding()) return null;
  const selectors = [
    '#main [role="application"]',
    '#main [data-testid="conversation-panel-wrapper"]',
    '#main [data-testid="conversation-panel-body"]',
    '#main .copyable-area',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el) && findVisibleChatHeader()) return el;
  }
  return null;
}

function getMainChatTitle() {
  for (const el of document.querySelectorAll(
    '#main header span[title], #main header span[dir="auto"], #main header h1, #main header h2',
  )) {
    const t = (el.getAttribute("title") ?? el.textContent ?? "").trim();
    if (t && t.length < 120 && !/whatsapp/i.test(t)) return t;
  }
  return "";
}

function isOnDownloadLanding() {
  // Check compose first — if it exists we are definitely in a chat
  if (findComposeFooterInput()) return false;
  const main = document.querySelector("#main");
  if (!main) return true;
  const t = (main.innerText ?? "").toLowerCase();
  // Only treat as landing if the download text is explicitly present
  // Do NOT treat missing compose alone as "download landing"
  return t.includes("download whatsapp for windows");
}

function chatOpenDiagnostics(contact) {
  const compose = findComposeFooterInput();
  waLog("chat open state", {
    contact,
    compose: compose ? labelOf(compose) : null,
    headerTitle: getMainChatTitle() || null,
    hasMainHeader: !!findVisibleChatHeader(),
    hasConversation: !!findConversationPanel(),
    downloadLanding: isOnDownloadLanding(),
  });
}

/** Chat open: visible compose OR (visible header + conversation panel). Title alone is not enough. */
function isChatValidated() {
  if (isOnDownloadLanding()) return false;
  if (findComposeFooterInput()) return true;
  return !!(findVisibleChatHeader() && findConversationPanel());
}

/** Poll until compose input appears (required for typing). */
async function waitForComposeInput(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
  let logged = false;
  let diagLogged = false;
  const input = await waitUntil(() => {
    const landing = isOnDownloadLanding();
    if (landing) return null;
    const compose = findComposeFooterInput();
    if (!compose) {
      if (!diagLogged) {
        diagLogged = true;
        const main = document.querySelector("#main");
        const allCE = main
          ? [...main.querySelectorAll('[contenteditable="true"]')].map(el => ({
              label: labelOf(el),
              role: el.getAttribute("role"),
              inFooter: !!el.closest("footer"),
              inSide: !!el.closest("#side"),
              visible: isVisible(el),
              top: Math.round(el.getBoundingClientRect().top),
              preview: isSearchPreviewCompose(el),
            }))
          : [];
        waLog("compose not found — contenteditable in #main", allCE);
        waLog("isOnDownloadLanding", landing);
        waLog("hasMainHeader", !!findVisibleChatHeader());
        waLog("hasConversation", !!findConversationPanel());
      }
      return null;
    }
    if (!logged) {
      waLog("compose detected", labelOf(compose));
      logged = true;
    }
    return compose;
  }, timeoutMs, CHAT_POLL_MS);
  return input;
}

/** Poll until compose OR header+conversation (sidebar / slow load). */
async function waitForComposeOrConversation(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
  let loggedCompose = false;
  let loggedConversation = false;
  return waitUntil(() => {
    if (isOnDownloadLanding()) return null;
    const compose = findComposeFooterInput();
    if (compose) {
      if (!loggedCompose) {
        waLog("compose detected", labelOf(compose));
        loggedCompose = true;
      }
      return compose;
    }
    if (findVisibleChatHeader() && findConversationPanel()) {
      if (!loggedConversation) {
        waLog("conversation detected");
        loggedConversation = true;
      }
      return "conversation";
    }
    return null;
  }, timeoutMs, CHAT_POLL_MS);
}

async function waitForChatValidated(contact, timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
  let loggedCompose = false;
  let loggedConversation = false;
  const ok = await waitUntil(() => {
    if (isOnDownloadLanding()) return null;
    const compose = findComposeFooterInput();
    if (compose) {
      if (!loggedCompose) {
        waLog("compose detected", labelOf(compose));
        waLog("chat validation passed", "compose");
        loggedCompose = true;
      }
      return true;
    }
    if (findVisibleChatHeader() && findConversationPanel()) {
      if (!loggedConversation) {
        waLog("conversation detected");
        waLog("chat validation passed", "header+conversation");
        loggedConversation = true;
      }
      return true;
    }
    return null;
  }, timeoutMs, CHAT_POLL_MS);
  if (!ok) chatOpenDiagnostics(contact);
  return !!ok;
}

const KEY_META = {
  ArrowDown: { keyCode: 40, code: "ArrowDown" },
  Enter: { keyCode: 13, code: "Enter" },
  Escape: { keyCode: 27, code: "Escape" },
};

function pressKey(el, key) {
  const meta = KEY_META[key] ?? { keyCode: 0, code: key };
  const targets = [el, document.activeElement, document.body].filter(Boolean);
  const seen = new Set();

  for (const target of targets) {
    if (seen.has(target)) continue;
    seen.add(target);
    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code: meta.code,
          keyCode: meta.keyCode,
          which: meta.keyCode,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }
}

function humanClick(el) {
  if (!el) return false;

  try {
    el.scrollIntoView({ block: "center" });
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const target = document.elementFromPoint(x, y) ?? el;

    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 1,
    };

    target.focus?.();
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ctor(type, opts));
    }
    if (typeof target.click === "function") target.click();

    return true;
  } catch (err) {
    waLog("click error", err);
    return false;
  }
}

/** Only the words to send — not the full voice command or contact name. */
function sanitizeMessageText(text) {
  let t = (text ?? "").trim();
  if (!t) return t;

  if (/\bsearch\b/i.test(t) && /\b(?:say|ask)\b/i.test(t)) {
    const m = t.match(/\b(?:say|ask)\s+(.+)$/i);
    if (m?.[1]) t = m[1].trim();
  }

  t = t.replace(/^goodnight\b/i, "good night");
  t = t.replace(/[.,!?]+\s*$/g, "").trim();
  return t;
}

function humanDoubleClick(el) {
  if (!el) return false;
  humanClick(el);
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  el.dispatchEvent(
    new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window,
    }),
  );
  return humanClick(el);
}

async function blurSearchBox(search) {
  pressKey(search, "Escape");
  await waitForComposeInput(CHAT_OPEN_TIMEOUT_MS);
}

function getEditableText(el) {
  if (el instanceof HTMLInputElement) return (el.value ?? "").trim();
  return (el.textContent ?? "").replace(/\u200b/g, "").trim();
}

function clearEditable(el) {
  el.focus();
  if (el instanceof HTMLInputElement) {
    el.value = "";
    return;
  }
  try {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand("delete", false, null);
  } catch (_) {
    /* ignore */
  }
  if ((el.textContent ?? "").length > 0) {
    el.textContent = "";
  }
}

function findMessageInput() {
  const mainFooter = document.querySelector("#main footer");
  if (mainFooter) {
    for (const el of mainFooter.querySelectorAll('[contenteditable="true"]')) {
      if (isVisible(el) && !el.closest("#side")) {
        waLog("compose footer found", labelOf(el));
        return el;
      }
    }
  }

  const footer = findComposeFooterInput();
  if (footer) {
    waLog("compose footer found", labelOf(footer));
    return footer;
  }

  const main = document.querySelector("#main");
  if (main) {
    for (const el of main.querySelectorAll('[contenteditable="true"]')) {
      if (!isVisible(el)) continue;
      if (el.closest("#side")) continue;
      if (isSearchPreviewCompose(el)) continue;
      waLog("compose fallback found", {
        label: labelOf(el),
        role: el.getAttribute("role"),
        top: Math.round(el.getBoundingClientRect().top),
      });
      return el;
    }
  }
  return null;
}

async function openSearchPanel() {
  for (let i = 0; i < 12; i++) {
    const found = findSearchInput();
    if (found) {
      waLog("search panel open", `attempt ${i + 1}`);
      return found;
    }

    const side = document.querySelector("#side");
    const clickables = side
      ? [
          ...side.querySelectorAll(
            '[data-icon="search"], [data-icon="search-refreshed"], [aria-label="Search"], button, [role="button"]',
          ),
        ]
      : [
          ...document.querySelectorAll(
            '[data-icon="search"], [data-icon="search-refreshed"], [aria-label="Search"]',
          ),
        ];

    for (const node of clickables) {
      const target =
        node.closest("button") ??
        node.closest('[role="button"]') ??
        node.parentElement ??
        node;
      try {
        target.click();
      } catch (_) {
        /* ignore */
      }
    }

    const sideHeader = side?.querySelector("header");
    if (sideHeader) sideHeader.click();

    await sleep(280);
  }

  return findSearchInput();
}

async function focusAndType(el, text, options = {}) {
  const { click = true } = options;
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
  el.focus({ preventScroll: true });
  if (click) el.click();
  await sleep(120);
  await insertText(el, text);

  const written = getEditableText(el);
  const needle = text.trim().slice(0, Math.min(4, text.length));
  if (needle && !written.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`Failed to type "${text}" into field (${labelOf(el) || "unknown"})`);
  }
}

function setEditableText(el, msg) {
  if (el instanceof HTMLInputElement) {
    el.value = msg;
  } else {
    el.textContent = msg;
  }
}

/** If field already contains duplicated text, collapse to a single copy. */
function dedupeEditableText(el, msg) {
  const target = String(msg ?? "").trim();
  if (!target) return;

  let written = getEditableText(el);
  if (written === target) return;

  const doubled = target + target;
  if (written === doubled || written.startsWith(doubled)) {
    waLog("dedupe message", written.slice(0, 60));
    setEditableText(el, target);
    return;
  }

  const re = new RegExp(`(${escapeRegExp(target)}){2,}`, "gi");
  if (re.test(written)) {
    waLog("dedupe message", written.slice(0, 60));
    setEditableText(el, target);
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Insert message exactly once — no paste, no InputEvent (WhatsApp duplicates those). */
async function insertText(el, text) {
  const msg = String(text ?? "").trim();
  clearEditable(el);
  el.focus();

  try {
    document.execCommand("insertText", false, msg);
  } catch (_) {
    /* ignore */
  }

  let written = getEditableText(el);
  if (written !== msg) {
    setEditableText(el, msg);
    written = getEditableText(el);
  }

  dedupeEditableText(el, msg);
}

function collectContactRows() {
  const rows = [];
  const seen = new Set();

  const add = (el, text) => {
    const t = (text ?? "").trim();
    if (!t || t.length > 80 || seen.has(t.toLowerCase())) return;
    const row = el.closest('[role="listitem"]') ?? el;
    if (!isVisible(row)) return;
    seen.add(t.toLowerCase());
    rows.push({ el: row, text: t });
  };

  for (const item of document.querySelectorAll(
    '#side div[role="listitem"], #side div[role="row"]',
  )) {
    const title =
      item.querySelector("span[title]")?.getAttribute("title") ??
      item.getAttribute("aria-label") ??
      item.textContent?.split("\n")[0];
    add(item, title);
  }

  return rows;
}

function findBestContact(contact) {
  const rows = collectContactRows();
  const scored = rows
    .map((row) => ({
      ...row,
      score: Math.max(
        similarity(contact, row.text),
        similarity(contact, row.text.split(/\s/)[0] ?? ""),
      ),
    }))
    .filter((r) => r.score >= MIN_CONTACT_SCORE)
    .sort((a, b) => b.score - a.score);

  if (scored[0]) {
    waLog("contact ranked", {
      query: contact,
      best: scored[0].text,
      score: scored[0].score.toFixed(2),
      top3: scored.slice(0, 3).map((s) => `${s.text}(${s.score.toFixed(2)})`),
    });
  }
  return scored[0] ?? null;
}

/** Match search results / chat list — uses fuzzy title (Abhishek → Abhishek ( Work )). */
function findClickableContact(contact) {
  let best = null;
  let bestScore = 0;

  const consider = (el, title) => {
    const t = (title ?? "").trim();
    if (!t || t.length > 80) return;
    const score = similarity(contact, t);
    if (score <= bestScore) return;

    const row = el.closest('[role="listitem"]') ?? el.closest('[role="row"]') ?? el;
    if (!isVisible(row)) return;

    bestScore = score;
    const titleSpan = row.querySelector("span[title]") ?? el;
    best = {
      row,
      titleSpan,
      cell: row.querySelector('[role="gridcell"], [data-testid="cell-frame-container"]') ?? row,
      text: t,
      score,
    };
  };

  for (const span of document.querySelectorAll("#side span[title]")) {
    consider(span, span.getAttribute("title"));
  }

  for (const row of document.querySelectorAll('#side [role="listitem"], #side [role="row"]')) {
    if (!isVisible(row)) continue;
    const title =
      row.querySelector("span[title]")?.getAttribute("title") ??
      row.getAttribute("aria-label") ??
      row.textContent?.split("\n")[0];
    consider(row, title);
  }

  if (best) {
    waLog("contact pick", {
      query: contact,
      best: best.text,
      score: best.score.toFixed(2),
    });
  }

  if (best && bestScore >= MIN_CONTACT_SCORE) return best;
  return null;
}

function findSidebarChatRow(contact) {
  const side = document.querySelector("#side");
  if (!side) return null;

  let best = null;
  let bestScore = 0;

  for (const row of side.querySelectorAll('[role="listitem"], [role="row"]')) {
    if (!isVisible(row)) continue;
    const title =
      row.querySelector("span[title]")?.getAttribute("title") ??
      row.getAttribute("aria-label") ??
      row.textContent?.split("\n")[0]?.trim();
    if (!title || title.length > 80) continue;

    const score = similarity(contact, title);
    if (score <= bestScore) continue;

    bestScore = score;
    best = {
      row,
      titleSpan: row.querySelector("span[title]") ?? row,
      text: title,
      score,
    };
  }

  if (best && bestScore >= MIN_CONTACT_SCORE) {
    waLog("sidebar row", { query: contact, best: best.text, score: best.score.toFixed(2) });
    return best;
  }
  return null;
}

async function closeSearchPanel() {
  pressKey(document.body, "Escape");
  await waitUntil(() => !document.activeElement?.closest?.("#side header"), 2000, CHAT_POLL_MS);
  pressKey(document.body, "Escape");
}

/**
 * FIX: Removed the Escape keypress after finding compose.
 * The old code called pressKey(search, "Escape") which dismissed the newly opened chat.
 * Now we just wait for compose and return true — no Escape, no second wait.
 */
async function waitForComposeAfterOpen(step, timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
  // Accept compose box OR (header + conversation panel) — chat is open either way
  const result = await waitUntil(() => {
    if (isOnDownloadLanding()) return null;
    const compose = findComposeFooterInput();
    if (compose) return { compose };
    if (findVisibleChatHeader() && findConversationPanel()) return { conversation: true };
    return null;
  }, timeoutMs, CHAT_POLL_MS);
  if (result) {
    waLog("chat validation passed", step + (result.conversation ? " (header+conv)" : " (compose)"));
    return true;
  }
  return false;
}

/**
 * FIX: No longer re-focuses the search element to send ArrowDown.
 * Instead we dispatch ArrowDown on document.activeElement / document.body,
 * so we don't steal focus back from the chat that's loading.
 */
async function keyboardSelectSearchResult(timeoutMs = CHAT_OPEN_TIMEOUT_MS) {
  // The active element at this point should be the first search result row.
  // Send ArrowDown + Enter on body so we don't forcibly re-focus the search box.
  pressKey(document.body, "ArrowDown");
  await sleep(120);
  pressKey(document.body, "Enter");
  return waitForComposeInput(timeoutMs);
}

/** Open chat from left chat list — success only when compose box appears (can type). */
async function openContactFromSidebar(contact) {
  if (isOnDownloadLanding()) {
    waLog("sidebar skip", "download landing — search is faster");
    return false;
  }

  await closeSearchPanel();
  await dismissBlockingModals();

  const hit = findSidebarChatRow(contact);
  if (!hit) {
    waLog("sidebar skip", "contact not in chat list");
    return false;
  }

  waLog("opening from sidebar", hit.text);

  for (let attempt = 1; attempt <= SIDEBAR_MAX_ATTEMPTS; attempt++) {
    waLog(`retry click ${attempt}`);
    humanClick(hit.row);
    humanClick(hit.titleSpan);

    const compose = await waitForComposeInput(SIDEBAR_ATTEMPT_MS);
    if (compose) {
      waLog("chat validation passed", "sidebar-compose");
      return true;
    }
  }

  waLog("sidebar failed", "no compose — trying search");
  return false;
}

async function openChatFromSearch(search, contact) {
  const query = contact.trim();

  await focusAndType(search, query);
  waLog("typed contact in search", query);

  const hit = await waitUntil(
    () => findClickableContact(query),
    SEARCH_HIT_TIMEOUT_MS,
    CHAT_POLL_MS,
  );

  if (!hit) {
    throw new Error(
      `No contact found for "${query}" — check the name in WhatsApp search, then retry`,
    );
  }

  assertContactMatch(hit, contact);
  waLog("opening", hit.text);

  // A) ArrowDown → Enter on body (don't re-focus search box)
  waLog("strategy A", "keyboard ArrowDown+Enter");
  if (await keyboardSelectSearchResult(CHAT_OPEN_TIMEOUT_MS)) {
    if (await waitForComposeAfterOpen("keyboard", COMPOSE_QUICK_MS)) return;
  }

  // B) Click the list row directly
  waLog("strategy B", "click row");
  humanClick(hit.row);
  if (await waitForComposeAfterOpen("click-row", CHAT_OPEN_TIMEOUT_MS)) return;

  // C) Click title span
  waLog("strategy C", "click title");
  humanClick(hit.titleSpan);
  if (await waitForComposeAfterOpen("click-title", CHAT_OPEN_TIMEOUT_MS)) return;

  // D) Double click row
  waLog("strategy D", "double-click row");
  humanDoubleClick(hit.row);
  if (await waitForComposeAfterOpen("double-click-row", CHAT_OPEN_TIMEOUT_MS)) return;

  // E) Click the cell (data-testid="cell-frame-container")
  waLog("strategy E", "click cell");
  humanClick(hit.cell);
  if (await waitForComposeAfterOpen("click-cell", CHAT_OPEN_TIMEOUT_MS)) return;

  // F) Fallback: clear search, retype, ArrowDown+Enter on body
  waLog("strategy F", "fallback retype");
  // Clear search without pressing Escape (Escape could navigate away)
  try {
    await focusAndType(search, "");
    await sleep(150);
    await focusAndType(search, query);
    await waitUntil(() => findClickableContact(query), SEARCH_HIT_TIMEOUT_MS, CHAT_POLL_MS);
  } catch (_) {
    /* best effort */
  }
  if (await keyboardSelectSearchResult(CHAT_OPEN_TIMEOUT_MS)) {
    if (await waitForComposeAfterOpen("fallback-keyboard", CHAT_OPEN_TIMEOUT_MS)) return;
  }

  if (isOnDownloadLanding()) {
    throw new Error(
      `WhatsApp shows "Download for Windows" on the right — click "${contact}" in the left chat list once, then retry Ripple`,
    );
  }

  throw new Error(
    `Chat not opened for "${contact}" — open that chat once manually, then retry`,
  );
}

function assertContactMatch(match, query) {
  if (!match) {
    throw new Error(`No chat found for "${query}"`);
  }
  if (match.score < MIN_CONTACT_SCORE) {
    throw new Error(
      `Low confidence: ${match.text} (${match.score.toFixed(2)}) for "${query}"`,
    );
  }
}

async function waitForWaReady() {
  waLog("waiting for WhatsApp ready");
  const ok = await waitUntil(
    () => document.querySelector("#side") || document.querySelector('[data-icon="search"]'),
    15000,
    200,
  );
  if (!ok) throw new Error("WhatsApp Web not ready — wait for chat list to load");
  waLog("WhatsApp ready");
}

async function searchAndOpen(contact) {
  await waitForWaReady();
  await dismissBlockingModals();

  if (await openContactFromSidebar(contact)) {
    const compose = findComposeFooterInput();
    if (compose) {
      waLog("chat ready (sidebar)", labelOf(compose));
      return;
    }
    waLog("sidebar opened but no compose — continuing to search");
  }

  let search = await openSearchPanel();
  if (!search) {
    search = await waitUntil(() => findSearchInput(), 4000);
  }
  if (!search) {
    throw new Error(
      "Search box not found — dismiss any WhatsApp popup (click OK), refresh web.whatsapp.com, reload extension",
    );
  }

  waLog("search found", labelOf(search));
  waLog("starting search flow", contact);
  await openChatFromSearch(search, contact);
  // openChatFromSearch already validated the chat — do NOT re-poll here.
  // A second waitForComposeInput would run AFTER the search Escape closes the view.
  await dismissBlockingModals();
  waLog("chat ready (search flow complete)");
}

async function insertMessage(text, send) {
  await dismissBlockingModals();

  const message = sanitizeMessageText(text);
  if (!message) {
    waLog("no message text — chat open only");
    return;
  }

  // Try immediately first (chat already open), then poll
  const input = findMessageInput() ??
    (await waitUntil(() => findMessageInput(), 8000, 200));
  if (!input) {
    throw new Error(
      "Message box not found — open a chat first (right side should show messages, not Download WhatsApp)",
    );
  }

  waLog("input found", labelOf(input));

  const existing = getEditableText(input);
  if (existing === message) {
    waLog("message already present — skip insert");
    return;
  }
  if (existing && existing.includes(message + message)) {
    dedupeEditableText(input, message);
    waLog("message deduped — skip insert");
    return;
  }

  waLog("message to type", message);
  await focusAndType(input, message, { click: false });
  dedupeEditableText(input, message);
  waLog("message typed", send ? "(will send)" : "(draft)");

  if (send) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        bubbles: true,
      }),
    );
    waLog("sent");
  } else {
    waLog("draft ready");
  }
}

(function registerRippleWaListener() {
  const root = globalThis;
  if (root.__rippleWaListenerRegistered) return;
  root.__rippleWaListenerRegistered = true;

  let runInProgress = false;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "WHATSAPP_RUN") return;

    if (runInProgress) {
      waLog("run skipped", "already in progress");
      sendResponse({ ok: false, error: "WhatsApp run already in progress" });
      return true;
    }

    runInProgress = true;

    (async () => {
      try {
        waLog("run start", { contact: msg.contact, send: !!msg.send });
        await searchAndOpen(msg.contact);
        await insertMessage(msg.text, msg.send);
        const hasText = String(msg.text ?? "").trim().length > 0;
        sendResponse({
          ok: true,
          detail: msg.send && hasText
            ? `Sent to ${msg.contact}`
            : hasText
              ? `Draft for ${msg.contact}`
              : `Opened chat with ${msg.contact}`,
        });
      } catch (e) {
        waLog("run failed", e?.message ?? String(e));
        sendResponse({ ok: false, error: e?.message ?? String(e) });
      } finally {
        runInProgress = false;
      }
    })();

    return true;
  });
})();