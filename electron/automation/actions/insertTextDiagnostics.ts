import type { TypingObservationResult } from "../../agent/types.js";
import {
  getForegroundWindow,
  getInsertTextA11yDiagnostics,
  type A11yNodeSnapshot,
  type InsertTextA11yDiagnostics,
} from "../../native/win32Bridge.js";

const LOG_PREFIX = "[ripple-insert-text-diag]";

export type InsertTextDiagPhase =
  | "entry"
  | "pre_insert"
  | "post_insert"
  | "verify_fail";

export function insertTextDiagnosticsEnabled(): boolean {
  return process.env.RIPPLE_INSERT_TEXT_DIAG !== "0";
}

function preview(value: string, max = 120): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function formatNode(node: A11yNodeSnapshot, index?: number): string {
  const prefix = index === undefined ? "" : `#${index} `;
  const valuePart = node.value ? ` value="${preview(node.value, 80)}"` : "";
  const focusPart = node.hasKeyboardFocus ? " [keyboard-focus]" : "";
  const enabledPart = node.enabled ? "" : " [disabled]";
  return (
    `${prefix}depth=${node.depth} role=${node.controlType}` +
    ` name="${preview(node.name, 60)}"` +
    ` automationId="${node.automationId || "-"}"` +
    ` class="${node.className || "-"}"` +
    `${valuePart}${focusPart}${enabledPart}`
  );
}

function logDiagnosticsBlock(
  diag: InsertTextA11yDiagnostics | null,
  fg: Awaited<ReturnType<typeof getForegroundWindow>>,
): void {
  const title = diag?.windowTitle ?? fg?.windowTitle ?? "?";
  const process = diag?.processName ?? fg?.processName ?? "?";
  const hwnd = diag?.hwnd ?? fg?.hwnd ?? 0;

  console.info(`${LOG_PREFIX} active_window title="${title}"`);
  console.info(
    `${LOG_PREFIX} active_window process=${process} hwnd=${hwnd || "?"}`,
  );

  if (!diag) {
    console.warn(`${LOG_PREFIX} a11y_diagnostics unavailable (native UIA RPC)`);
    return;
  }

  if (diag.focused) {
    console.info(`${LOG_PREFIX} focused_element ${formatNode(diag.focused)}`);
  } else {
    console.warn(`${LOG_PREFIX} focused_element none`);
  }

  if (diag.ancestorChain.length > 0) {
    console.info(
      `${LOG_PREFIX} ancestor_chain (${diag.ancestorChain.length} parents):`,
    );
    for (const node of diag.ancestorChain) {
      console.info(`${LOG_PREFIX}   ${formatNode(node)}`);
    }
  } else {
    console.info(`${LOG_PREFIX} ancestor_chain empty`);
  }

  if (diag.editableElements.length > 0) {
    console.info(
      `${LOG_PREFIX} editable_elements (${diag.editableElements.length}):`,
    );
    diag.editableElements.forEach((node, i) => {
      console.info(`${LOG_PREFIX}   ${formatNode(node, i)}`);
    });
  } else {
    console.warn(`${LOG_PREFIX} editable_elements none detected in foreground window`);
  }
}

/** Dump UIA context for INSERT_TEXT — window, focus chain, editable fields. */
export async function logInsertTextDiagnostics(
  phase: InsertTextDiagPhase,
  opts?: {
    textPreview?: string;
    keys?: string;
    mouseAction?: string;
    sequenceSteps?: number;
  },
): Promise<void> {
  if (!insertTextDiagnosticsEnabled()) return;

  const parts = [
    `phase=${phase}`,
    opts?.textPreview ? `text="${preview(opts.textPreview, 60)}"` : null,
    opts?.keys ? `keys=${opts.keys}` : null,
    opts?.mouseAction ? `mouse=${opts.mouseAction}` : null,
    opts?.sequenceSteps ? `sequence=${opts.sequenceSteps}` : null,
  ].filter(Boolean);

  console.info(`${LOG_PREFIX} ${parts.join(" ")}`);

  const [fg, diag] = await Promise.all([
    getForegroundWindow(),
    getInsertTextA11yDiagnostics(),
  ]);
  logDiagnosticsBlock(diag, fg);
}

/** Explain why verifyTypingObservation returned ok=false. */
export function logVerificationFailure(
  verified: TypingObservationResult,
  expectedText?: string,
): void {
  if (!insertTextDiagnosticsEnabled()) return;
  if (verified.ok) return;

  const reason = verified.reason ?? "unknown";
  console.warn(`${LOG_PREFIX} verify_failed reason=${reason}`);

  const before = verified.before;
  const after = verified.after;
  const beforeFg = before.foreground;
  const afterFg = after.foreground;
  const beforeA11y = before.focusedA11y;
  const afterA11y = after.focusedA11y;

  console.info(
    `${LOG_PREFIX} verify_before fg="${beforeFg?.windowTitle ?? "?"}"` +
      ` process=${beforeFg?.processName ?? "?"} hwnd=${beforeFg?.hwnd ?? "?"}`,
  );
  console.info(
    `${LOG_PREFIX} verify_after fg="${afterFg?.windowTitle ?? "?"}"` +
      ` process=${afterFg?.processName ?? "?"} hwnd=${afterFg?.hwnd ?? "?"}`,
  );

  if (beforeA11y) {
    console.info(
      `${LOG_PREFIX} verify_before_focus role=${beforeA11y.controlType}` +
        ` name="${preview(beforeA11y.name, 60)}"` +
        ` value="${preview(beforeA11y.value ?? "", 60)}"`,
    );
  }
  if (afterA11y) {
    console.info(
      `${LOG_PREFIX} verify_after_focus role=${afterA11y.controlType}` +
        ` name="${preview(afterA11y.name, 60)}"` +
        ` value="${preview(afterA11y.value ?? "", 60)}"`,
    );
  }

  switch (reason) {
    case "keys_landed_in_ripple":
      console.warn(
        `${LOG_PREFIX} why: keystrokes landed in Ripple overlay/app instead of target window`,
      );
      break;
    case "foreground_changed":
      console.warn(
        `${LOG_PREFIX} why: foreground window changed during insert` +
          ` (${beforeFg?.hwnd ?? "?"} → ${afterFg?.hwnd ?? "?"})`,
      );
      break;
    case "a11y_name_mismatch":
      console.warn(
        `${LOG_PREFIX} why: focused control name does not contain expected text snippet` +
          ` expected="${preview(expectedText ?? "", 24)}"` +
          ` actual_name="${preview(afterA11y?.name ?? "", 60)}"`,
      );
      break;
    default:
      if (reason.startsWith("focus_not_editable:")) {
        const role = reason.slice("focus_not_editable:".length);
        console.warn(
          `${LOG_PREFIX} why: focused element is not edit-like` +
            ` role=${role}` +
            ` (expected Edit/Document/Text; classic editors like Notepad are exempt)`,
        );
      } else {
        console.warn(`${LOG_PREFIX} why: ${reason}`);
      }
  }
}
