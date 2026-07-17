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
};

async function tryNativeTextInsert(text: string): Promise<boolean> {
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
  await simulateTyping(text);
  return true;
}

async function tryClipboardPasteInsert(text: string): Promise<boolean> {
  await restoreFocusContext();
  await delay(350);
  const focus = getFocusContext();
  if (focus?.processName) {
    await ensureEditorKeyboardFocus();
    await delay(150);
  }
  clipboard.writeText(text);
  await delay(80);
  await selectAll();
  await delay(60);
  await pasteFromClipboard();
  return true;
}

async function tryVisionInsert(text: string): Promise<boolean> {
  return runVisionInsert(text);
}

function strategiesToRun(
  skipThrough?: InsertStrategyName,
): Array<{ name: InsertStrategyName; run: (text: string) => Promise<boolean> }> {
  const all = [
    { name: "native_text" as const, run: tryNativeTextInsert },
    { name: "sendkeys" as const, run: trySendKeysInsert },
    { name: "clipboard_paste" as const, run: tryClipboardPasteInsert },
    { name: "vision" as const, run: tryVisionInsert },
  ];
  if (!skipThrough) return all;
  const idx = STRATEGY_ORDER.indexOf(skipThrough);
  if (idx < 0) return all;
  return all.slice(idx + 1);
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
  const strategies = strategiesToRun(options?.skipThrough);

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
          console.warn(
            `[ripple-p85] insert verify failed strategy=${strategy.name} reason=${verified.reason ?? "unknown"}`,
          );
          continue;
        }
      }

      console.info(
        `[ripple-p85] insert strategy=${strategy.name} len=${text.length}`,
      );
      return {
        detail: strategyDetail(strategy.name, text),
        strategy: strategy.name,
      };
    } catch (e: unknown) {
      lastError = e;
      console.warn(
        `[ripple-p85] insert strategy ${strategy.name} failed:`,
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
