import { clipboard } from "electron";
import {
  isWeakFocusContext,
  resolveTypingFocusTarget,
} from "../focus/focusContext.js";
import { ensureEditorKeyboardFocus } from "./editorFocus.js";
import {
  isCopySequence,
  isCutSequence,
  isClearTextSequence,
  isPasteKeys,
  isNavigationKeys,
  isNavigationSequence,
  sequenceDelayMs,
  type KeyStep,
} from "./keySequenceHelpers.js";
import {
  isElectronEditorProcess,
  isClassicTextEditorProcess,
} from "./editorFocus.js";
import {
  getForegroundWindow,
  sendKeysNative,
  runInputSequenceNative,
} from "../native/win32Bridge.js";
import { verifyTypingObservation } from "./observe.js";
import type { ObservationSnapshot } from "./types.js";

function targetLabel(): string {
  const target = resolveTypingFocusTarget();
  if (!target) return "target window";
  const title = target.windowTitle?.slice(0, 50) || "?";
  return `${target.processName} ("${title}")`;
}

async function assertForegroundMatchesTarget(skipForNavigation = false): Promise<void> {
  if (skipForNavigation) return;
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) return;
  const fg = await getForegroundWindow();
  if (!fg?.hwnd) return;
  if (Number(fg.hwnd) === target.hwnd) return;

  const fgTitle = (fg.windowTitle ?? "").toLowerCase();
  const fgProc = (fg.processName ?? "").toLowerCase();
  const targetProc = (target.processName ?? "").toLowerCase();
  if (
    fgProc &&
    fgProc === targetProc &&
    /\bsave(\s*as)?\b/.test(fgTitle)
  ) {
    return;
  }

  throw new Error(
    `Focus is on ${fg.processName ?? "?"} ("${(fg.windowTitle ?? "").slice(0, 40)}") — expected ${targetLabel()}. Click into Notepad and try again.`,
  );
}

/**
 * P7 send_keys — skip parent HWND for Notepad/IDEs so focus_hwnd does not
 * steal the inner edit control. Editor click in ensureEditorKeyboardFocus
 * places the caret; native SendInput delivers keys (unchanged P7 path).
 */
function nativeTargetArgs(): { hwnd?: number; titleHint?: string } {
  const target = resolveTypingFocusTarget();
  if (!target?.hwnd) return {};
  if (isWeakFocusContext(target)) {
    return target.windowTitle ? { titleHint: target.windowTitle } : {};
  }
  if (
    isElectronEditorProcess(target.processName) ||
    isClassicTextEditorProcess(target.processName)
  ) {
    return { titleHint: target.windowTitle };
  }
  return { hwnd: target.hwnd, titleHint: target.windowTitle };
}

function writeClipboardProbe(): string {
  const probe = `__ripple_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
  clipboard.writeText(probe);
  return probe;
}

async function runSequenceOnTarget(
  targetArgs: { hwnd?: number; titleHint?: string },
  steps: KeyStep[],
  delayMs: number,
): Promise<void> {
  const result = await runInputSequenceNative({
    ...targetArgs,
    steps,
    delayMs,
  });
  if (!result?.ok) {
    const fg = result?.foregroundTitle?.slice(0, 60) ?? "unknown";
    throw new Error(
      `Keys did not reach ${targetLabel()} — foreground is "${fg}"`,
    );
  }
}

async function pasteFromClipboardNative(
  targetArgs: { hwnd?: number; titleHint?: string },
): Promise<string> {
  const text = clipboard.readText();
  if (!text.trim()) {
    throw new Error("Clipboard is empty — copy text first (select all and copy)");
  }
  const result = await sendKeysNative({
    ...targetArgs,
    keys: "^v",
    delayMs: 100,
  });
  if (!result?.ok) throw new Error("Failed to paste clipboard text");
  return `Pasted ${text.length} chars from clipboard`;
}

async function copySelectionToClipboard(
  targetArgs: { hwnd?: number; titleHint?: string },
  steps: KeyStep[],
): Promise<string> {
  const probe = writeClipboardProbe();
  await new Promise((r) => setTimeout(r, 80));
  const target = resolveTypingFocusTarget();
  await runSequenceOnTarget(
    targetArgs,
    steps,
    sequenceDelayMs(target?.processName),
  );
  await new Promise((r) => setTimeout(r, 320));
  const after = clipboard.readText();
  if (!after.trim() || after === probe) {
    throw new Error(
      `Copy failed in ${targetLabel()} — keys did not copy text (click into the editor and try again)`,
    );
  }
  return `Copied ${after.length} chars from ${targetLabel()} to clipboard`;
}

async function cutSelectionToClipboard(
  targetArgs: { hwnd?: number; titleHint?: string },
  steps: KeyStep[],
): Promise<string> {
  const probe = writeClipboardProbe();
  await new Promise((r) => setTimeout(r, 80));
  const target = resolveTypingFocusTarget();
  await runSequenceOnTarget(
    targetArgs,
    steps,
    sequenceDelayMs(target?.processName),
  );
  await new Promise((r) => setTimeout(r, 320));
  const after = clipboard.readText();
  if (!after.trim() || after === probe) {
    throw new Error(
      `Cut failed in ${targetLabel()} — keys did not cut text (click into the editor and try again)`,
    );
  }
  return `Cut ${after.length} chars from ${targetLabel()} to clipboard`;
}

/** P9 — one retry when keys did not land in the target app. */
export async function retryDesktopKeys(args: {
  keys?: string;
  steps?: KeyStep[];
  beforeObserve: ObservationSnapshot;
  strictVerify?: boolean;
}): Promise<{ ok: boolean; detail: string }> {
  const runOnce = async (): Promise<string> => {
    await ensureEditorKeyboardFocus({
      keys: args.keys,
      steps: args.steps,
    });
    const isNav =
      isNavigationKeys(args.keys) || isNavigationSequence(args.steps);
    await assertForegroundMatchesTarget(isNav);
    const targetArgs = nativeTargetArgs();
    const app = targetLabel();
    const target = resolveTypingFocusTarget();
    const stepDelay = sequenceDelayMs(target?.processName);

    if (isPasteKeys(args.keys)) {
      const msg = await pasteFromClipboardNative(targetArgs);
      return msg.replace("clipboard", `${app} clipboard`);
    }

    if (args.steps?.length && isCopySequence(args.steps)) {
      return copySelectionToClipboard(targetArgs, args.steps);
    }

    if (args.steps?.length && isCutSequence(args.steps)) {
      return cutSelectionToClipboard(targetArgs, args.steps);
    }

    if (args.steps?.length) {
      await runSequenceOnTarget(targetArgs, args.steps, stepDelay);
      return `Executed key sequence in ${app} (${args.steps.length} steps)`;
    }

    if (args.keys) {
      const result = await sendKeysNative({
        ...targetArgs,
        keys: args.keys,
        delayMs: 100,
      });
      if (!result?.ok) throw new Error("Failed to send key command");
      return `Executed key command in ${app}: ${args.keys}`;
    }

    throw new Error("No keys to send");
  };

  let detail = await runOnce();
  const isPaste = isPasteKeys(args.keys);
  const isCopy = Boolean(args.steps?.length && isCopySequence(args.steps));
  const isCut = Boolean(args.steps?.length && isCutSequence(args.steps));
  const isClear = Boolean(args.steps?.length && isClearTextSequence(args.steps));
  const isNav =
    isNavigationKeys(args.keys) || isNavigationSequence(args.steps);
  const clipboardOp = isPaste || isCopy || isCut;

  let verified = await verifyTypingObservation({
    before: args.beforeObserve,
    settleMs: clipboardOp ? 120 : isClear ? 280 : isNav ? 80 : 220,
    keysOnly: !clipboardOp,
    navigationOnly: isNav,
  });

  if (!verified.ok && !clipboardOp && !isNav) {
    console.warn(
      `[ripple-desktop] typing retry: ${verified.reason ?? "failed"} — refocusing and retrying once`,
    );
    detail = await runOnce();
    verified = await verifyTypingObservation({
      before: args.beforeObserve,
      settleMs: isNav ? 80 : 280,
      keysOnly: true,
      navigationOnly: isNav,
    });
  }

  if (!verified.ok && args.strictVerify !== false && !clipboardOp && !isNav) {
    throw new Error(`Typing verification failed: ${verified.reason ?? "unknown"}`);
  }

  return { ok: clipboardOp ? true : verified.ok, detail };
}
