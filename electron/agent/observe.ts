import {
  getFocusedA11yElement,
  getForegroundWindow,
} from "../native/win32Bridge.js";
import type { ObservationSnapshot, TypingObservationResult } from "./types.js";
import {
  isRippleApplicationWindow,
  isWeakFocusContext,
  matchesPinnedInsertTarget,
  resolveTypingFocusTarget,
} from "../focus/focusContext.js";

function isClassicEditorProcess(processName?: string): boolean {
  const p = (processName ?? "").toLowerCase();
  return p === "notepad" || p.includes("wordpad");
}

function beforeWasWeakOrRipple(before: ObservationSnapshot): boolean {
  const fg = before.foreground;
  if (!fg?.hwnd) return true;
  if (
    isRippleApplicationWindow(fg.processName ?? "", fg.windowTitle ?? "")
  ) {
    return true;
  }
  return isWeakFocusContext({
    hwnd: fg.hwnd,
    processName: fg.processName ?? "",
    windowTitle: fg.windowTitle ?? "",
  });
}

function sameAppProcess(a: string, b: string): boolean {
  const ap = a.toLowerCase();
  const bp = b.toLowerCase();
  if (!ap || !bp) return false;
  if (ap === bp) return true;
  return ap.includes(bp) || bp.includes(ap);
}

export async function captureObservation(): Promise<ObservationSnapshot> {
  // Timing only — these are UIA round trips and every insert path calls them,
  // so they are prime suspects for the compose→paste time that live logs could
  // not attribute. No behaviour change.
  const started = Date.now();
  const [foreground, focusedA11y] = await Promise.all([
    getForegroundWindow(),
    getFocusedA11yElement(),
  ]);
  const ms = Date.now() - started;
  if (ms >= 50) {
    console.info(`[ripple-latency] insert_phase observe=${ms}ms`);
  }
  return {
    foreground,
    focusedA11y,
    timestamp: Date.now(),
  };
}

/** P9 — verify typing landed in an edit-like control when possible. */
export async function verifyTypingObservation(args: {
  before: ObservationSnapshot;
  expectedText?: string;
  settleMs?: number;
  keysOnly?: boolean;
  /** Arrow/home/end — skip foreground_changed and editable-field checks. */
  navigationOnly?: boolean;
}): Promise<TypingObservationResult> {
  // Timing only — the post-insert verify (settle sleep + UIA re-read) runs after
  // the text has already landed, so every ms here is pure perceived latency.
  const started = Date.now();
  try {
    return await verifyTypingObservationInner(args);
  } finally {
    const ms = Date.now() - started;
    if (ms >= 50) {
      console.info(`[ripple-latency] insert_phase verify=${ms}ms`);
    }
  }
}

async function verifyTypingObservationInner(args: {
  before: ObservationSnapshot;
  expectedText?: string;
  settleMs?: number;
  keysOnly?: boolean;
  navigationOnly?: boolean;
}): Promise<TypingObservationResult> {
  const settleMs = args.settleMs ?? 200;
  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }
  let after = await captureObservation();

  const fgBefore = args.before.foreground?.hwnd;
  let fgAfter = after.foreground?.hwnd;
  const afterProc = after.foreground?.processName ?? "";
  const afterTitle = after.foreground?.windowTitle ?? "";
  const pinned = resolveTypingFocusTarget();

  if (isRippleApplicationWindow(afterProc, afterTitle)) {
    return {
      ok: false,
      reason: "keys_landed_in_ripple",
      before: args.before,
      after,
    };
  }

  if (args.navigationOnly) {
    return { ok: true, before: args.before, after };
  }

  if (fgBefore && fgAfter && fgBefore !== fgAfter && args.keysOnly) {
    const beforeRipple = args.before.foreground
      ? isRippleApplicationWindow(
          args.before.foreground.processName ?? "",
          args.before.foreground.windowTitle ?? "",
        )
      : false;
    if (!beforeRipple) {
      return {
        ok: false,
        reason: "foreground_changed",
        before: args.before,
        after,
      };
    }
  } else if (fgBefore && fgAfter && fgBefore !== fgAfter) {
    const beforeRipple = args.before.foreground
      ? isRippleApplicationWindow(
          args.before.foreground.processName ?? "",
          args.before.foreground.windowTitle ?? "",
        )
      : false;

    const afterMatchesPin =
      pinned &&
      after.foreground &&
      matchesPinnedInsertTarget(after.foreground, pinned);
    const beforeMatchesPin =
      pinned &&
      args.before.foreground &&
      matchesPinnedInsertTarget(args.before.foreground, pinned);

    // Deliberate restore to pinned target (explorer/Cursor → chrome Chat).
    if (
      !beforeRipple &&
      pinned &&
      afterMatchesPin &&
      (beforeWasWeakOrRipple(args.before) || !beforeMatchesPin)
    ) {
      // Continue — expected outcome of prepareDictationInsertFocus + paste.
    } else if (
      pinned &&
      after.foreground &&
      !afterMatchesPin
    ) {
      return {
        ok: false,
        reason: "wrong_insert_target",
        before: args.before,
        after,
      };
    } else if (!beforeRipple) {
      // Editor apps (Cursor/VS Code) can transiently swap the reported
      // foreground hwnd right after a keystroke lands (IntelliSense/format
      // popup) even though the text already landed correctly and focus
      // settles back a beat later.
      await new Promise((r) => setTimeout(r, 200));
      const resettled = await captureObservation();
      if (resettled.foreground?.hwnd === fgBefore) {
        after = resettled;
        fgAfter = resettled.foreground?.hwnd;
      } else {
        const beforeProc = args.before.foreground?.processName ?? "";
        const afterResettledProc = resettled.foreground?.processName ?? "";
        const sameAppChurn =
          sameAppProcess(beforeProc, afterResettledProc) &&
          pinned &&
          resettled.foreground &&
          matchesPinnedInsertTarget(resettled.foreground, pinned);
        if (!sameAppChurn) {
          return {
            ok: false,
            reason: "foreground_changed",
            before: args.before,
            after: resettled,
          };
        }
        after = resettled;
        fgAfter = resettled.foreground?.hwnd;
      }
    }
  }

  const control = after.focusedA11y?.controlType?.toLowerCase() ?? "";
  const inEditField =
    control.includes("edit") ||
    control.includes("document") ||
    control.includes("text");

  if (!args.keysOnly && after.focusedA11y && !inEditField) {
    if (isClassicEditorProcess(after.foreground?.processName)) {
      return { ok: true, before: args.before, after };
    }
    return {
      ok: false,
      reason: `focus_not_editable:${after.focusedA11y.controlType}`,
      before: args.before,
      after,
    };
  }

  if (args.expectedText?.trim() && after.focusedA11y) {
    const snippet = args.expectedText.trim().slice(0, 24).toLowerCase();
    const controlIsDocument = control.includes("document");
    const name = (after.focusedA11y.name ?? "").toLowerCase();
    const value = (after.focusedA11y.value ?? "").toLowerCase();
    const beforeValue = (args.before.focusedA11y?.value ?? "").toLowerCase();
    const placeholderName =
      /\btype\s+a\s+message\b/i.test(name) ||
      /\bcompose\b/i.test(name) ||
      /\bwrite\s+a\s+(?:message|mail|email)\b/i.test(name) ||
      /\bsubject\b/i.test(name);

    if (snippet.length >= 4 && !controlIsDocument) {
      const inValue = value.includes(snippet);
      const valueGrew =
        value.length > beforeValue.length ||
        (beforeValue.length === 0 && value.length > 0);
      const valueGrewWithText =
        valueGrew &&
        (inValue ||
          snippet
            .split(/\s+/)
            .filter((w) => w.length >= 4)
            .some((w) => value.includes(w)));

      if (inValue || valueGrewWithText) {
        return { ok: true, before: args.before, after };
      }
      if (placeholderName && inEditField && valueGrew) {
        return { ok: true, before: args.before, after };
      }

      const inName = !placeholderName && name.includes(snippet);
      if (!inValue && !inName && !valueGrewWithText) {
        if (!value.trim()) {
          return {
            ok: false,
            reason: "a11y_name_mismatch",
            before: args.before,
            after,
          };
        }
        if (value === beforeValue || !inEditField) {
          return {
            ok: false,
            reason: "a11y_name_mismatch",
            before: args.before,
            after,
          };
        }
      }
    }
  }

  return { ok: true, before: args.before, after };
}
