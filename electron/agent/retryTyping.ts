import { clipboard } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isWeakFocusContext,
  resolveTypingFocusTarget,
} from "../focus/focusContext.js";
import { ensureEditorKeyboardFocus } from "./editorFocus.js";
import {
  assertOsTestLockNotViolated,
  clipboardTiming,
  ensureHardFocusBarrier,
  isClassicEditorClipboardTarget,
} from "./focusBarrier.js";
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

const execFileAsync = promisify(execFile);
const CLIPBOARD_MAX_ATTEMPTS = 3;

function targetLabel(): string {
  const target = resolveTypingFocusTarget();
  if (!target) return "target window";
  const title = target.windowTitle?.slice(0, 50) || "?";
  return `${target.processName} ("${title}")`;
}

async function assertForegroundMatchesTarget(skipForNavigation = false): Promise<void> {
  if (skipForNavigation) return;
  await ensureHardFocusBarrier(3);
}

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

async function readOsClipboard(): Promise<string> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        ["-NoProfile", "-STA", "-Command", "Get-Clipboard -Raw"],
        { encoding: "utf8", timeout: 5000 },
      );
      return (stdout ?? "").trim();
    } catch {
      /* fall through */
    }
  }
  return clipboard.readText();
}

/** Win11 Notepad ignores low-level SendInput for ^a/^c — use STA SendKeys like manual QA. */
async function sendClassicEditorChords(keys: string): Promise<void> {
  const escaped = keys.replace(/'/g, "''");
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-STA",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
    ],
    { timeout: 10_000, windowsHide: true },
  );
}

function normalizeSequenceSteps(
  steps: KeyStep[],
): Array<{ type: "keys"; value: string; delayMs?: number }> {
  return steps.map((s) => ({
    type: "keys" as const,
    value: s.value,
    ...(s.delayMs != null ? { delayMs: s.delayMs } : {}),
  }));
}

async function runSequenceOnTarget(
  targetArgs: { hwnd?: number; titleHint?: string },
  steps: KeyStep[],
  delayMs: number,
): Promise<void> {
  await ensureHardFocusBarrier(3);
  const result = await runInputSequenceNative({
    ...targetArgs,
    steps: normalizeSequenceSteps(steps),
    delayMs,
  });
  if (!result?.ok) {
    const fg = result?.foregroundTitle?.slice(0, 60) ?? "unknown";
    throw new Error(
      `Keys did not reach ${targetLabel()} — foreground is "${fg}"`,
    );
  }
}

async function sendKeyStepsOnTarget(
  targetArgs: { hwnd?: number; titleHint?: string },
  steps: KeyStep[],
): Promise<void> {
  await ensureHardFocusBarrier(3);
  for (const step of steps) {
    const keys = step.value?.trim();
    if (!keys) continue;
    await assertOsTestLockNotViolated();
    const result = await sendKeysNative({
      ...targetArgs,
      keys,
      delayMs: step.delayMs ?? 90,
    });
    if (!result?.ok) {
      const fg = result?.foregroundTitle?.slice(0, 60) ?? "unknown";
      throw new Error(
        `Keys did not reach ${targetLabel()} — foreground is "${fg}"`,
      );
    }
    await new Promise((r) => setTimeout(r, 60));
  }
}

async function pasteFromClipboardNative(
  targetArgs: { hwnd?: number; titleHint?: string },
): Promise<string> {
  await ensureHardFocusBarrier(3);
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

async function classicEditorClipboardOp(
  op: "copy" | "cut",
): Promise<string> {
  const actionKey = op === "cut" ? "^x" : "^c";
  const actionLabel = op === "cut" ? "Cut" : "Copied";
  let lastErr = "clipboard unchanged";

  for (let attempt = 1; attempt <= CLIPBOARD_MAX_ATTEMPTS; attempt++) {
    try {
      await assertOsTestLockNotViolated();
      await ensureEditorKeyboardFocus({ clipboardOp: true });

      const probe = `__ripple_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
      clipboard.writeText(probe);
      await new Promise((r) => setTimeout(r, 80));
      const baseline = probe;

      await sendClassicEditorChords("^a");
      await new Promise((r) => setTimeout(r, clipboardTiming.selectAllSettleMs));
      await sendClassicEditorChords(actionKey);
      await new Promise((r) => setTimeout(r, clipboardTiming.clipboardSettleMs));

      const after = (await readOsClipboard()).trim();
      if (after && after !== baseline) {
        return `${actionLabel} ${after.length} chars from ${targetLabel()} to clipboard`;
      }
      lastErr = `clipboard unchanged (before=${baseline.slice(0, 20)}, after=${after.slice(0, 20)})`;
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    `${op === "cut" ? "Cut" : "Copy"} failed in ${targetLabel()} — ${lastErr}`,
  );
}

async function copySelectionToClipboard(
  targetArgs: { hwnd?: number; titleHint?: string },
  steps: KeyStep[],
): Promise<string> {
  if (isClassicEditorClipboardTarget()) {
    return classicEditorClipboardOp("copy");
  }

  const probe = writeClipboardProbe();
  await new Promise((r) => setTimeout(r, 80));
  await sendKeyStepsOnTarget(targetArgs, steps);
  await new Promise((r) => setTimeout(r, clipboardTiming.clipboardSettleMs));
  const after = (await readOsClipboard()).trim();
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
  if (isClassicEditorClipboardTarget()) {
    return classicEditorClipboardOp("cut");
  }

  const probe = writeClipboardProbe();
  await new Promise((r) => setTimeout(r, 80));
  await sendKeyStepsOnTarget(targetArgs, steps);
  await new Promise((r) => setTimeout(r, clipboardTiming.clipboardSettleMs));
  const after = (await readOsClipboard()).trim();
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
  const isNav =
    isNavigationKeys(args.keys) || isNavigationSequence(args.steps);
  const isCopy =
    Boolean(args.steps?.length && isCopySequence(args.steps)) ||
    Boolean(args.keys && /^\^c$/i.test(args.keys.trim()));
  const isCut =
    Boolean(args.steps?.length && isCutSequence(args.steps)) ||
    Boolean(args.keys && /^\^x$/i.test(args.keys.trim()));
  const clipboardOp =
    isPasteKeys(args.keys) || isCopy || isCut;

  const runOnce = async (): Promise<string> => {
    await ensureEditorKeyboardFocus({
      keys: args.keys,
      steps: args.steps,
      clipboardOp,
    });
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

    if (args.keys && /^\^c$/i.test(args.keys.trim())) {
      return copySelectionToClipboard(targetArgs, [
        { type: "keys", value: "^c", delayMs: 100 },
      ]);
    }

    if (args.keys && /^\^x$/i.test(args.keys.trim())) {
      return cutSelectionToClipboard(targetArgs, [
        { type: "keys", value: "^x", delayMs: 100 },
      ]);
    }

    if (args.keys) {
      await ensureHardFocusBarrier(3);
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

  let detail = "";
  let lastErr: unknown;
  const maxAttempts = clipboardOp ? CLIPBOARD_MAX_ATTEMPTS : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      detail = await runOnce();
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) {
        console.warn(
          `[ripple-desktop] clipboard retry ${attempt}/${maxAttempts}: ${e instanceof Error ? e.message : e}`,
        );
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }

  if (lastErr) {
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  const isClear = Boolean(args.steps?.length && isClearTextSequence(args.steps));

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
