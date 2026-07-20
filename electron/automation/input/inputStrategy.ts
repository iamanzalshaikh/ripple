import { clipboard } from "electron";
import { delay } from "../delay.js";
import { getFocusContext, restoreFocusContext } from "../../focus/focusContext.js";
import { ensureEditorKeyboardFocus } from "../../agent/editorFocus.js";
import {
  pasteFromClipboard,
  selectAll,
  simulateTyping,
} from "../keyboard.js";
import { runInputSequenceNative } from "../../native/win32Bridge.js";
import { resolveTypingFocusTarget } from "../../focus/focusContext.js";
import { captureObservation, verifyTypingObservation } from "../../agent/observe.js";
import type { ObservationSnapshot } from "../../agent/types.js";
import { runVisionInsert, visionInsertEnabled } from "./visionInsert.js";

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
};

async function tryNativeTextInsert(text: string): Promise<boolean> {
  await restoreFocusContext();
  await delay(120);
  const focus = resolveTypingFocusTarget();
  const result = await runInputSequenceNative({
    hwnd: focus?.hwnd,
    titleHint: focus?.windowTitle,
    delayMs: 60,
    steps: [{ type: "text", value: text, delayMs: 40 }],
  });
  return result?.ok === true;
}

async function trySendKeysInsert(text: string): Promise<boolean> {
  await restoreFocusContext();
  await delay(120);
  await simulateTyping(text);
  return true;
}

async function tryClipboardPasteInsert(
  text: string,
  replaceAll = false,
): Promise<boolean> {
  await restoreFocusContext();
  await delay(350);
  const focus = getFocusContext();
  if (focus?.processName) {
    await ensureEditorKeyboardFocus();
    await delay(150);
  }
  clipboard.writeText(text);
  await delay(80);
  if (replaceAll) {
    await selectAll();
    await delay(60);
  }
  await pasteFromClipboard();
  return true;
}

async function tryVisionInsert(text: string): Promise<boolean> {
  return runVisionInsert(text);
}

function strategiesToRun(
  options?: InsertFallbackOptions,
): Array<{ name: InsertStrategyName; run: (text: string) => Promise<boolean> }> {
  const all = [
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

/**
 * P8.5-P5.2 insert ladder: native UIA text → SendKeys → clipboard paste → vision click+paste.
 * Optional verify loop retries the next strategy when typing observation fails.
 */
export async function runInsertWithFallback(
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
      if (!ok) continue;

      if (before && options?.verify !== false) {
        const verified = await verifyTypingObservation({
          before,
          expectedText: text,
          settleMs: 220,
        });
        if (!verified.ok) {
          const control =
            verified.after?.focusedA11y?.controlType?.toLowerCase() ?? "";
          const unverifiableEditable =
            options?.acceptUnverifiableEdit === true &&
            verified.reason === "a11y_name_mismatch" &&
            (control.includes("edit") ||
              control.includes("document") ||
              control.includes("text"));
          if (unverifiableEditable) {
            console.warn(
              `[ripple-insert] strategy=${strategy.name} verify=unavailable editable=true; accepting to avoid duplicate retry`,
            );
          } else {
            console.warn(
              `[ripple-insert] strategy=${strategy.name} verify=fail reason=${verified.reason ?? "unknown"}`,
            );
            continue;
          }
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
      console.warn(
        `[ripple-insert] strategy=${strategy.name} status=fail error=`,
        e instanceof Error ? e.message : e,
      );
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
