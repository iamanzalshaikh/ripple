import { clipboard } from "electron";
import { delay } from "../delay.js";
import {
  ensureInsertForeground,
  getFocusContext,
  matchesPinnedInsertTarget,
  resolveTypingFocusTarget,
} from "../../focus/focusContext.js";
import { ensureEditorKeyboardFocus } from "../../agent/editorFocus.js";
import {
  pasteFromClipboard,
  selectAll,
  simulateTyping,
} from "../keyboard.js";
import { getForegroundWindow, runInputSequenceNative } from "../../native/win32Bridge.js";
import { captureObservation, verifyTypingObservation } from "../../agent/observe.js";
import type { ObservationSnapshot } from "../../agent/types.js";
import { runVisionInsert, visionInsertEnabled } from "./visionInsert.js";
import { assertPreSendGates } from "./insertGates.js";
import { createHash } from "node:crypto";

export type InsertStrategyName =
  | "native_text"
  | "sendkeys"
  | "clipboard_paste"
  | "vision";

export { visionInsertEnabled };

const STRATEGY_ORDER: InsertStrategyName[] = [
  "native_text",
  "sendkeys",
  "clipboard_paste",
  "vision",
];

export type InsertFallbackOptions = {
  /** Run post-type verify after each strategy; retry next on failure. */
  verify?: boolean;
  beforeObserve?: ObservationSnapshot;
  /** Skip strategies through this name (recovery after partial success). */
  skipThrough?: InsertStrategyName;
  /** Put this strategy first (e.g. clipboard for long WhatsApp messages). */
  preferFirst?: InsertStrategyName;
  /** Replace the whole focused field when clipboard is used. Default inserts at caret. */
  replaceAll?: boolean;
  /** Vision is optional and inappropriate for an already-focused web composer. */
  includeVision?: boolean;
  /**
   * Web contenteditables sometimes expose only a placeholder name and no value.
   * Accept a successful OS insert in an editable control instead of retrying and
   * duplicating text when verification is impossible.
   */
  acceptUnverifiableEdit?: boolean;
  /**
   * After a strategy reports ok=false following a likely partial type (native
   * disconnect mid-sequence), do not try later strategies that would re-emit
   * the full string and duplicate. Caller should only set this for surfaces
   * where partial append is preferable to double text.
   */
  abortLadderOnPartialNativeFail?: boolean;
};

// Q4 — long dictations get mid-send foreground checkpoints instead of only
// verifying at the very start/end, so a focus steal partway through (Windows
// shell/search flyout) is caught immediately.
const CHECKPOINT_TEXT_THRESHOLD = 100;
const CHECKPOINT_CHUNK_SIZE = 60;
/** Settle time before handing the user's clipboard back after a paste. */
const CLIPBOARD_RESTORE_DELAY_MS = 700;

/**
 * Deferred clipboard hand-back. Bumped on every paste-strategy insert so a
 * restore scheduled by an earlier insert can never overwrite the clipboard a
 * later one is still relying on.
 */
let clipboardRestoreGeneration = 0;
let pendingClipboardRestore: ReturnType<typeof setTimeout> | null = null;
let pendingClipboardRestoreRun: (() => void) | null = null;

function scheduleClipboardRestore(original: string): void {
  const generation = ++clipboardRestoreGeneration;
  if (pendingClipboardRestore) clearTimeout(pendingClipboardRestore);

  const run = (): void => {
    pendingClipboardRestore = null;
    pendingClipboardRestoreRun = null;
    // A newer insert has claimed the clipboard since — leave it alone.
    if (generation !== clipboardRestoreGeneration) {
      console.info(
        `[ripple-insert] clipboard_restore_superseded gen=${generation}`,
      );
      return;
    }
    try {
      clipboard.writeText(original);
      console.info(`[ripple-insert] clipboard_restored len=${original.length}`);
    } catch {
      /* best-effort — never fail an insert that already landed */
    }
  };

  pendingClipboardRestoreRun = run;
  pendingClipboardRestore = setTimeout(run, CLIPBOARD_RESTORE_DELAY_MS);
  // Do not keep the event loop (or a quitting app) alive just for this.
  pendingClipboardRestore.unref?.();
}

/** Test-only — run any pending clipboard restore now instead of waiting. */
export function flushClipboardRestoreForTests(): void {
  const run = pendingClipboardRestoreRun;
  if (pendingClipboardRestore) clearTimeout(pendingClipboardRestore);
  pendingClipboardRestore = null;
  pendingClipboardRestoreRun = null;
  run?.();
}

/** Split on whitespace where possible so a chunk boundary doesn't split a word. */
function splitIntoCheckpointChunks(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) end = lastSpace + 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function assertInsertForeground(): Promise<void> {
  if (!(await ensureInsertForeground())) {
    throw new Error("insert_aborted:ripple_foreground");
  }
}

async function tryNativeTextInsert(text: string): Promise<boolean> {
  await assertInsertForeground();
  await delay(120);
  await assertPreSendGates("native_text");
  const focus = resolveTypingFocusTarget();

  if (text.length <= CHECKPOINT_TEXT_THRESHOLD) {
    const result = await runInputSequenceNative({
      hwnd: focus?.hwnd,
      titleHint: focus?.windowTitle,
      delayMs: 60,
      steps: [{ type: "text", value: text, delayMs: 40 }],
    });
    return result?.ok === true;
  }

  // Q2/Q4 — chunk long text and verify foreground between chunks. Answers
  // "how many characters were sent before the change": we track sentChars
  // exactly and abort cleanly (throw insert_aborted:*) instead of silently
  // sending the remainder into the wrong window or letting a later ladder
  // strategy re-type the full string on top of the already-sent chunks.
  const chunks = splitIntoCheckpointChunks(text, CHECKPOINT_CHUNK_SIZE);
  let sentChars = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];

    // Verify BEFORE sending each chunk, including the first.
    //
    // The check used to run only *between* chunks, so chunks 1 and 2 were
    // always sent unverified — live 2026-08-20 that leaked 111 of 250
    // characters into an Instagram message box before chunk 3 noticed
    // ("native checkpoint chunk 3/5 failed; sentChars=111/250"). This is a
    // read-only foreground comparison: it aborts earlier and never moves or
    // claims focus.
    const fgBeforeChunk = await getForegroundWindow();
    if (
      focus?.hwnd &&
      fgBeforeChunk?.hwnd &&
      Number(fgBeforeChunk.hwnd) !== Number(focus.hwnd)
    ) {
      console.warn(
        `[ripple-insert] native checkpoint: foreground changed BEFORE chunk ` +
          `${i + 1}/${chunks.length} hwnd ${focus.hwnd}→${fgBeforeChunk.hwnd} ` +
          `proc=${fgBeforeChunk.processName ?? "?"} — sentChars=${sentChars}/${text.length}; aborting`,
      );
      throw new Error(
        `insert_aborted:foreground_changed_mid_send:sentChars=${sentChars}:total=${text.length}`,
      );
    }

    const result = await runInputSequenceNative({
      hwnd: focus?.hwnd,
      titleHint: focus?.windowTitle,
      delayMs: 60,
      steps: [{ type: "text", value: chunk, delayMs: 40 }],
    });
    if (result?.ok !== true) {
      console.warn(
        `[ripple-insert] native checkpoint chunk ${i + 1}/${chunks.length} failed; sentChars=${sentChars}/${text.length}`,
      );
      return false;
    }
    sentChars += chunk.length;
    if (i < chunks.length - 1) {
      const fg = await getForegroundWindow();
      if (
        focus?.hwnd &&
        fg?.hwnd &&
        Number(fg.hwnd) !== Number(focus.hwnd)
      ) {
        console.warn(
          `[ripple-insert] native checkpoint: foreground changed mid-send ` +
            `hwnd ${focus.hwnd}→${fg.hwnd} proc=${fg.processName ?? "?"} — ` +
            `sentChars=${sentChars}/${text.length}; aborting remainder`,
        );
        throw new Error(
          `insert_aborted:foreground_changed_mid_send:sentChars=${sentChars}:total=${text.length}`,
        );
      }
    }
  }
  return true;
}

async function trySendKeysInsert(text: string): Promise<boolean> {
  await assertInsertForeground();
  await delay(120);
  await assertPreSendGates("sendkeys");
  await simulateTyping(text);
  return true;
}

async function tryClipboardPasteInsert(
  text: string,
  replaceAll = false,
): Promise<boolean> {
  await assertInsertForeground();
  await delay(350);
  // Re-check immediately before keys — Ripple can steal FG during the settle delay.
  await assertInsertForeground();
  const focus = getFocusContext();
  if (focus?.processName) {
    // clipboardOp: browsers use SetFocus/safe composer path — avoid a second
    // blind physical click that can select a desktop icon (Program Manager).
    await ensureEditorKeyboardFocus({ clipboardOp: true });
    await delay(150);
    await assertInsertForeground();
  }
  // Snapshot whatever the user had on the clipboard so we can hand it back.
  // Dictation previously destroyed it on every paste-strategy insert.
  let originalClipboard: string | null = null;
  try {
    originalClipboard =
      typeof clipboard.readText === "function" ? clipboard.readText() : null;
  } catch {
    originalClipboard = null;
  }

  clipboard.writeText(text);
  await delay(80);
  // Read-back before the paste keystroke — a clipboard set that silently
  // failed (another app clearing/owning it) pastes stale content.
  let rewrite = 0;
  let readBack: string | null = null;
  try {
    readBack =
      typeof clipboard.readText === "function" ? clipboard.readText() : null;
    if (readBack !== null && readBack !== text) {
      clipboard.writeText(text);
      await delay(60);
      readBack = clipboard.readText();
      rewrite = 1;
    }
  } catch {
    readBack = null;
  }
  const checked = readBack ?? text;
  const hash8 = createHash("sha256").update(checked).digest("hex").slice(0, 8);
  console.info(
    `[ripple-insert] clipboard_check len=${checked.length} hash8=${hash8}` +
      `${rewrite ? " clipboard_rewrite=1" : ""}` +
      `${readBack === null ? " readback=unavailable" : ""}` +
      `${readBack !== null && readBack !== text ? " MISMATCH_AFTER_REWRITE=1" : ""}`,
  );
  if (replaceAll) {
    await selectAll();
    await delay(60);
  }
  // Gates immediately before the paste keystroke — never fire Ctrl+V while a
  // Win key is down (shell shortcut) or at a hidden/minimized target.
  await assertPreSendGates("clipboard_paste");
  try {
    await pasteFromClipboard();
    console.info("[ripple-insert] paste_send result=ok");
  } catch (e: unknown) {
    console.warn(
      `[ripple-insert] paste_send result=error error=${e instanceof Error ? e.message : e}`,
    );
    throw e;
  }

  // Hand the user's clipboard back. The settle delay still happens AFTER the
  // paste (restoring earlier could race the target app still reading it), but
  // it is no longer AWAITED: the text has already landed, so making dictation
  // sit here spent 700 ms of the user's stop→paste time on housekeeping. Live
  // 2026-08-20 showed the worst case — `clipboard_restored len=0`, i.e. 700 ms
  // spent restoring an empty clipboard.
  if (originalClipboard !== null && originalClipboard !== text) {
    scheduleClipboardRestore(originalClipboard);
  }
  return true;
}

async function tryVisionInsert(text: string): Promise<boolean> {
  return runVisionInsert(text);
}

function strategiesToRun(
  options?: InsertFallbackOptions,
): Array<{ name: InsertStrategyName; run: (text: string) => Promise<boolean> }> {
  let all = [
    { name: "native_text" as const, run: tryNativeTextInsert },
    { name: "sendkeys" as const, run: trySendKeysInsert },
    {
      name: "clipboard_paste" as const,
      run: (text: string) => tryClipboardPasteInsert(text, options?.replaceAll),
    },
    { name: "vision" as const, run: tryVisionInsert },
  ].filter(
    (strategy) => strategy.name !== "vision" || options?.includeVision !== false,
  );
  if (options?.preferFirst) {
    const preferred = all.find((s) => s.name === options.preferFirst);
    if (preferred) {
      all = [preferred, ...all.filter((s) => s.name !== options.preferFirst)];
    }
  }
  if (!options?.skipThrough) return all;
  const idx = STRATEGY_ORDER.indexOf(options.skipThrough);
  if (idx < 0) return all;
  const skipped = new Set(STRATEGY_ORDER.slice(0, idx + 1));
  return all.filter((strategy) => !skipped.has(strategy.name));
}

function strategyDetail(name: InsertStrategyName, text: string): string {
  if (name === "clipboard_paste" || name === "vision") {
    return `Pasted ${text.length} characters (${name})`;
  }
  return `Typed ${text.length} characters (${name})`;
}

function isUnsafeInsertFocus(focused: {
  name?: string;
  className?: string;
  controlType?: string;
  value?: string;
} | null | undefined): boolean {
  if (!focused) return true;
  const name = (focused.name ?? "").toLowerCase();
  const cls = (focused.className ?? "").toLowerCase();
  const value = (focused.value ?? "").toLowerCase();
  if (cls.includes("omnibox") || name.includes("address and search")) return true;
  if (value.startsWith("chrome-error://") || value.includes("err_connection")) {
    return true;
  }
  return false;
}

/**
 * True only when the *pinned* app's focused edit already holds our text.
 * Refuse omnibox / error pages / wrong FG — live 2026-08-12: native sent 0
 * chars into a Chrome error tab, then this path still reported inserted=true.
 */
async function focusedFieldAlreadyContains(text: string): Promise<boolean> {
  try {
    const pinned = resolveTypingFocusTarget();
    const fg = await getForegroundWindow();
    if (pinned && fg && !matchesPinnedInsertTarget(fg, pinned)) {
      console.warn(
        `[ripple-insert] refuse already-has-text — FG ${fg.processName ?? "?"} ≠ pin ${pinned.processName}`,
      );
      return false;
    }

    const { getInsertTextA11yDiagnostics } = await import(
      "../../native/win32Bridge.js"
    );
    const diag = await getInsertTextA11yDiagnostics();
    if (isUnsafeInsertFocus(diag?.focused)) {
      console.warn(
        "[ripple-insert] refuse already-has-text — focused control is omnibox/error page",
      );
      return false;
    }

    const value = (diag?.focused?.value ?? "").toLowerCase();
    if (!value) return false;
    const needle = text.trim().toLowerCase();
    if (!needle) return false;
    // Require full text, or ≥70% of a long utterance — not a loose 40-char head
    // match that can hit unrelated UI chrome.
    if (value.includes(needle)) return true;
    if (needle.length < 48) return false;
    const minKeep = Math.max(48, Math.floor(needle.length * 0.7));
    const head = needle.slice(0, minKeep);
    return value.includes(head);
  } catch {
    return false;
  }
}

/**
 * P8.5-P5.2 insert ladder: native UIA text → SendKeys → clipboard paste → vision click+paste.
 * Optional verify loop retries the next strategy when typing observation fails.
 */
/**
 * Row 1.9 — inserts must not overlap. A 300-char dictation is delivered in
 * 60-char chunks over several hundred ms; if a second dictation began
 * inserting inside that window the two character streams interleaved and both
 * sentences arrived shredded into each other. Serializing costs nothing in the
 * normal, non-overlapping case: the queue is already resolved.
 *
 * The wait is bounded, so a wedged predecessor can never permanently block
 * dictation — past the cap we proceed anyway rather than dropping the user's
 * text on the floor.
 */
const INSERT_QUEUE_MAX_WAIT_MS = 15_000;
let insertQueueTail: Promise<unknown> = Promise.resolve();

function enqueueInsert<T>(run: () => Promise<T>): Promise<T> {
  const predecessor = insertQueueTail;
  let release!: () => void;
  // `slot` only ever resolves, so the tail can never reject.
  insertQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  return (async () => {
    const queueStarted = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        predecessor.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.warn(
              `[ripple-insert] insert_queue_wait_timeout after ${INSERT_QUEUE_MAX_WAIT_MS}ms — proceeding`,
            );
            resolve();
          }, INSERT_QUEUE_MAX_WAIT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const queuedMs = Date.now() - queueStarted;
    if (queuedMs >= 100) {
      console.info(`[ripple-latency] insert_phase queue_wait=${queuedMs}ms`);
    }
    try {
      return await run();
    } finally {
      release();
    }
  })();
}

export function runInsertWithFallback(
  text: string,
  options?: InsertFallbackOptions,
): Promise<{ detail: string; strategy: InsertStrategyName }> {
  return enqueueInsert(() => runInsertWithFallbackInner(text, options));
}

async function runInsertWithFallbackInner(
  text: string,
  options?: InsertFallbackOptions,
): Promise<{ detail: string; strategy: InsertStrategyName }> {
  const before =
    options?.beforeObserve ??
    (options?.verify ? await captureObservation() : undefined);
  const strategies = strategiesToRun(options);

  let lastError: unknown = null;
  for (const strategy of strategies) {
    if (strategy.name === "vision" && !visionInsertEnabled()) continue;
    try {
      const ok = await strategy.run(text);
      if (!ok) {
        // native_text returned false after disconnect/timeout — field may
        // already contain a partial type. Later strategies re-emit full text.
        if (strategy.name === "native_text") {
          if (options?.abortLadderOnPartialNativeFail) {
            throw new Error(
              "native_text_partial_or_failed — refusing retype to avoid duplicate",
            );
          }
          if (await focusedFieldAlreadyContains(text)) {
            console.warn(
              "[ripple-insert] native_text ok=false but field already has text — accepting to avoid duplicate",
            );
            console.info(
              `[ripple-insert] strategy=native_text status=ok len=${text.length}`,
            );
            return {
              detail: strategyDetail("native_text", text),
              strategy: "native_text",
            };
          }
        }
        continue;
      }

      if (before && options?.verify !== false) {
        const verified = await verifyTypingObservation({
          before,
          expectedText: text,
          settleMs: 220,
        });
        if (!verified.ok) {
          const control =
            verified.after?.focusedA11y?.controlType?.toLowerCase() ?? "";
          const editLikeControl =
            control.includes("edit") ||
            control.includes("document") ||
            control.includes("text");

          // Value-change acceptance rule: a11y_name_mismatch on an editable
          // control is only acceptable when the field VALUE actually moved.
          // A byte-identical readable value = the paste landed nowhere (the
          // desktop-flash false success) — never convert that to ok.
          const normalizeValue = (s: string) =>
            s.replace(/\s+/g, " ").trim().toLowerCase();
          const valueBeforeNorm = normalizeValue(
            verified.before?.focusedA11y?.value ?? "",
          );
          const valueAfterNorm = normalizeValue(
            verified.after?.focusedA11y?.value ?? "",
          );
          const fragment = normalizeValue(text).slice(0, 24);
          const fragmentInAfter =
            fragment.length >= 4 && valueAfterNorm.includes(fragment);
          const valueSignal =
            valueBeforeNorm.length > 0 || valueAfterNorm.length > 0;
          const valueChanged = valueAfterNorm !== valueBeforeNorm;

          if (
            options?.acceptUnverifiableEdit === true &&
            verified.reason === "a11y_name_mismatch" &&
            editLikeControl &&
            valueSignal &&
            !valueChanged &&
            !fragmentInAfter
          ) {
            console.warn(
              `[ripple-insert] strategy=${strategy.name} paste_no_effect` +
                ` value_len=${valueAfterNorm.length} (byte-identical before/after)` +
                ` — explicit composer click + one retry`,
            );
            const { ensureBrowserComposerFocus } = await import(
              "../../agent/editorFocus.js"
            );
            const focusOk = await ensureBrowserComposerFocus();
            console.info(
              `[ripple-insert] composer_focus retry ok=${focusOk ? 1 : 0}`,
            );
            // Re-send is safe here: the readable field value being unchanged
            // proves the first send landed nowhere.
            const resent = await strategy.run(text);
            const reverified = resent
              ? await verifyTypingObservation({
                  before,
                  expectedText: text,
                  settleMs: 260,
                })
              : null;
            const reAfterNorm = normalizeValue(
              reverified?.after?.focusedA11y?.value ?? "",
            );
            const landedOnRetry =
              reverified?.ok === true ||
              (reAfterNorm.length > 0 && reAfterNorm !== valueBeforeNorm) ||
              (fragment.length >= 4 && reAfterNorm.includes(fragment));
            if (landedOnRetry) {
              console.info(
                `[ripple-insert] strategy=${strategy.name} status=ok len=${text.length} (landed_on_retry=1)`,
              );
              return {
                detail: strategyDetail(strategy.name, text),
                strategy: strategy.name,
              };
            }
            throw new Error("insert_aborted:paste_no_effect");
          }

          const unverifiableEditable =
            options?.acceptUnverifiableEdit === true &&
            verified.reason === "a11y_name_mismatch" &&
            editLikeControl &&
            // Accept only with evidence of landing (value moved / fragment
            // present) or when the control exposes no value at all (WhatsApp
            // Web contenteditable) — then a11y simply can't verify.
            (fragmentInAfter || (valueSignal && valueChanged) || !valueSignal);
          if (
            unverifiableEditable &&
            !valueSignal
          ) {
            console.info(
              `[ripple-insert] paste_landing=indeterminate_no_value strategy=${strategy.name} (control exposes no value — accepting)`,
            );
          }
          const beforeProc = (
            verified.before?.foreground?.processName ?? ""
          ).toLowerCase();
          const afterProc = (
            verified.after?.foreground?.processName ?? ""
          ).toLowerCase();
          // Same-app hwnd churn (IntelliSense/format popup) — not a real
          // foreground steal. Cross-app foreground_changed must NOT be
          // accepted (live: ChatGPT paste → Cursor stole FG, would report
          // success into the wrong window).
          const sameAppForegroundChurn =
            verified.reason === "foreground_changed" &&
            Boolean(beforeProc) &&
            Boolean(afterProc) &&
            (beforeProc === afterProc ||
              beforeProc.includes(afterProc) ||
              afterProc.includes(beforeProc));

          const pinned = resolveTypingFocusTarget();
          const restoredToPin =
            verified.reason === "foreground_changed" &&
            pinned &&
            verified.after?.foreground &&
            matchesPinnedInsertTarget(verified.after.foreground, pinned);

          // Strategy already committed SendKeys/paste. Continuing the ladder
          // re-emits the full string (live: Hello typed twice; Windows Search
          // stole FG mid-ladder and got a second paste). Never retry after ok.
          if (unverifiableEditable || sameAppForegroundChurn || restoredToPin) {
            console.warn(
              `[ripple-insert] strategy=${strategy.name} verify=fail reason=${verified.reason ?? "unknown"}; accepting committed insert to avoid duplicate`,
            );
            console.info(
              `[ripple-insert] strategy=${strategy.name} status=ok len=${text.length}`,
            );
            return {
              detail: strategyDetail(strategy.name, text),
              strategy: strategy.name,
            };
          }

          // Bug fix (Q1) — this used to fall through to "status=ok" success
          // below for EVERY verify failure reason, including
          // focus_not_editable (keys/paste landed on a non-editable control —
          // e.g. the Windows shell/search flyout, not the real target app)
          // and cross-app foreground_changed. Do not retry (same duplicate
          // risk as the accepted cases above) — but do not lie about success
          // either. Throw insert_aborted so the ladder stops here and the
          // caller sees a genuine failure.
          console.warn(
            `[ripple-insert] strategy=${strategy.name} verify=fail reason=${verified.reason ?? "unknown"} ${beforeProc || "?"}→${afterProc || "?"}; refusing ladder retry AND refusing false success`,
          );
          throw new Error(
            `insert_aborted:verify_failed:${verified.reason ?? "unknown"}:${beforeProc || "?"}→${afterProc || "?"}`,
          );
        }
      }

      console.info(
        `[ripple-insert] strategy=${strategy.name} status=ok len=${text.length}`,
      );
      return {
        detail: strategyDetail(strategy.name, text),
        strategy: strategy.name,
      };
    } catch (e: unknown) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[ripple-insert] strategy=${strategy.name} status=fail error=`,
        msg,
      );
      // Hard abort — do not try the next strategy after a committed/partial
      // insert (native chunk checkpoint abort, or a verify failure we just
      // refused to accept). Continuing here is exactly what caused the
      // production double-type bugs this ladder exists to prevent.
      if (/insert_aborted:/i.test(msg)) {
        throw e instanceof Error ? e : new Error(msg);
      }
    }
  }

  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "All insert strategies failed",
  );
}

/** Retry insert starting after the strategy that last failed verification. */
export async function retryInsertAfterVerifyFail(
  text: string,
  failedAfter: InsertStrategyName,
  beforeObserve: ObservationSnapshot,
): Promise<{ detail: string; strategy: InsertStrategyName } | null> {
  try {
    return await runInsertWithFallback(text, {
      verify: true,
      beforeObserve,
      skipThrough: failedAfter,
    });
  } catch {
    return null;
  }
}
