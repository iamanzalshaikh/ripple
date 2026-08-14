import { getPreSendStateNative, type PreSendState } from "../../native/win32Bridge.js";
import { resolveTypingFocusTarget } from "../../focus/focusContext.js";
import { delay } from "../delay.js";

const WIN_RELEASE_WAIT_MS = 300;
const TARGET_RESTORE_WAIT_MS = 500;
const GATE_POLL_MS = 100;

function b(v: boolean): 0 | 1 {
  return v ? 1 : 0;
}

/**
 * Pre-send safety gates, run immediately before EVERY synthetic input send
 * (native_text, sendkeys, and the clipboard Ctrl+V keystroke):
 *
 * 1. Modifier gate — sending anything while a Win key is physically (or
 *    phantom-)down turns the keystroke into a shell shortcut (Win+D show
 *    desktop, Win+M minimize all, Ctrl+Win+arrow desktop switch). Wait up to
 *    300ms for release, else abort insert_aborted:modifier_win_down.
 * 2. Target-state gate — a paste fired at an iconic/hidden pinned target
 *    (the desktop-flash state) lands nowhere while verify still sees an
 *    unchanged field. Wait up to 500ms for restoration, else abort
 *    insert_aborted:target_not_visible.
 *
 * Both emit unconditional log lines so any future flash is bracketed with
 * the exact modifier + window state at send time.
 */
async function probePreSendState(
  hwnd?: number,
): Promise<PreSendState | null> {
  try {
    if (typeof getPreSendStateNative !== "function") return null;
    return await getPreSendStateNative(hwnd);
  } catch {
    return null;
  }
}

export async function assertPreSendGates(strategy: string): Promise<void> {
  if (process.platform !== "win32") return;
  const pinned = resolveTypingFocusTarget();
  const state = await probePreSendState(pinned?.hwnd);
  if (!state) {
    // Native probe unavailable (non-win32 test env / PowerShell failure) —
    // log and continue; the gates are defense-in-depth, not the only check.
    console.warn(
      `[ripple-insert] modifiers_before_send strategy=${strategy} state=unavailable (gates skipped)`,
    );
    return;
  }

  console.info(
    `[ripple-insert] modifiers_before_send strategy=${strategy}` +
      ` win=${b(state.win)} ctrl=${b(state.ctrl)} shift=${b(state.shift)} alt=${b(state.alt)}`,
  );
  console.info(
    `[ripple-insert] target_state hwnd=${pinned?.hwnd ?? 0}` +
      ` visible=${b(state.visible)} iconic=${b(state.iconic)}` +
      ` fg_now=${state.fgProc || "?"}:${state.fgHwnd}`,
  );

  let current: PreSendState = state;

  if (current.win) {
    const deadline = Date.now() + WIN_RELEASE_WAIT_MS;
    while (current.win && Date.now() < deadline) {
      await delay(GATE_POLL_MS);
      current = (await probePreSendState(pinned?.hwnd)) ?? current;
    }
    if (current.win) {
      console.warn(
        `[ripple-insert] modifier_gate strategy=${strategy} win still down after ${WIN_RELEASE_WAIT_MS}ms — refusing send`,
      );
      throw new Error("insert_aborted:modifier_win_down");
    }
    console.info(
      `[ripple-insert] modifier_gate strategy=${strategy} win released — proceeding`,
    );
  }

  if (pinned?.hwnd && (!current.visible || current.iconic)) {
    const deadline = Date.now() + TARGET_RESTORE_WAIT_MS;
    while ((!current.visible || current.iconic) && Date.now() < deadline) {
      await delay(GATE_POLL_MS);
      current = (await probePreSendState(pinned.hwnd)) ?? current;
    }
    if (!current.visible || current.iconic) {
      console.warn(
        `[ripple-insert] target_gate strategy=${strategy} hwnd=${pinned.hwnd}` +
          ` visible=${b(current.visible)} iconic=${b(current.iconic)}` +
          ` after ${TARGET_RESTORE_WAIT_MS}ms — refusing send at hidden/minimized target`,
      );
      throw new Error("insert_aborted:target_not_visible");
    }
    console.info(
      `[ripple-insert] target_gate strategy=${strategy} hwnd=${pinned.hwnd} restored — proceeding`,
    );
  }
}
