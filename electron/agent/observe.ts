import {
  getFocusedA11yElement,
  getForegroundWindow,
} from "../native/win32Bridge.js";
import type { ObservationSnapshot, TypingObservationResult } from "./types.js";
import { isRippleApplicationWindow } from "../focus/focusContext.js";

function isClassicEditorProcess(processName?: string): boolean {
  const p = (processName ?? "").toLowerCase();
  return p === "notepad" || p.includes("wordpad");
}

export async function captureObservation(): Promise<ObservationSnapshot> {
  const [foreground, focusedA11y] = await Promise.all([
    getForegroundWindow(),
    getFocusedA11yElement(),
  ]);
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
  const settleMs = args.settleMs ?? 200;
  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs));
  }
  let after = await captureObservation();

  const fgBefore = args.before.foreground?.hwnd;
  let fgAfter = after.foreground?.hwnd;
  const afterProc = after.foreground?.processName ?? "";
  const afterTitle = after.foreground?.windowTitle ?? "";

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

    if (!beforeRipple) {
      // Editor apps (Cursor/VS Code) can transiently swap the reported
      // foreground hwnd right after a keystroke lands (IntelliSense/format
      // popups) even though the text already landed correctly and focus
      // settles back a beat later — reproduced live: dictation into Cursor
      // was reported as foreground_changed while the inserted text was
      // already correctly in the editor. Recheck once before failing so a
      // transient swap doesn't produce a false negative.
      await new Promise((r) => setTimeout(r, 200));
      const resettled = await captureObservation();
      if (resettled.foreground?.hwnd === fgBefore) {
        after = resettled;
        fgAfter = resettled.foreground?.hwnd;
      } else {
        return {
          ok: false,
          reason: "foreground_changed",
          before: args.before,
          after: resettled,
        };
      }
    }
    // else: "before" was Ripple's own overlay — moving focus to the real
    // target app IS the expected outcome of every dictation insert (the
    // overlay hides and the target app receives the text), not a
    // foreground steal. Reproduced live: the "before" snapshot gets
    // captured while the overlay still transiently reports itself as OS
    // foreground (hideOverlay() hasn't fully handed off focus yet), which
    // made verification fail on the very FIRST, already-successful insert
    // attempt every time — the ladder then kept retrying the remaining
    // strategies, and since none of them undo a prior successful insert,
    // each retry re-typed/re-pasted on top of the already-correct text
    // (a real, reproduced 4-5x duplicated-typing bug in Notepad).
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
      // WhatsApp / web contenteditables keep placeholder in `name` and typed
      // text in `value`. Prefer value (and value growth) over name.
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

      // Value match / growth wins — never fail solely because placeholder name
      // still says "Type a message…".
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
        // Non-empty value that doesn't match can still be a contenteditable
        // that reports stale/truncated value — accept if still in edit field
        // and value changed after insert.
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
