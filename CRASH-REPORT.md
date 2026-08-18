# Desktop-only focus loss on hotkey press — ROOT CAUSE FOUND

**Symptom (your words):** "on the notepad i focus but when i click to start hotkey its not focusing" — desktop apps only (Notepad, Cursor). Chrome is fine.

**Root cause: we inject a real Alt keystroke into your focused window at hotkey press.** Alt is the menu-activation key in Win32/Electron apps, so Notepad and Cursor move keyboard focus out of the text area and into the menu bar. Chrome ignores a bare Alt — which is exactly why only desktop apps break.

This is **not** a crash. No crash log was needed to find it; it is provable from the call chain.

## The chain (all verified in source)

1. You press the hotkey → `handleShortcutPress()` → `snapshotPreVoiceTarget()` (`electron/focus/focusContext.ts`)
2. It called `allowSetForegroundNative()` **unconditionally**, before even reading which window was focused
3. → RPC `"allow_set_foreground"` (`ripple-native/src/ipc/pipe_server.rs:174`)
4. → `grant_foreground_permission()` (`ripple-native/src/send_input.rs:201`)
5. → `synthetic_alt_tap()` (`send_input.rs:190`):

```rust
keybd_event(VK_MENU.0 as u8, 0, KEYBD_EVENT_FLAGS(0), 0);   // Alt DOWN
keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);        // Alt UP
```

`VK_MENU` is the **Alt** key. That is a genuine system-wide keystroke delivered to whatever window currently has focus — your Notepad/Cursor text area.

**Why it presents as "on-off":** Alt *toggles* menu-arm state in Win32 apps. Press once → menu armed, text focus lost. Press again → menu released, focus returns. Alternating presses look exactly like the intermittent on/off you described.

**Why Chrome was immune:** Chrome does not use an Alt-activated menu bar, so the injected Alt is a no-op there. Same code path, different app behavior — which is why "it works in Chrome" was never a clue that the code was correct.

## The fix

Foreground rights are only needed when we actually have to **change** the foreground. In the normal press (your target is already focused) we need nothing at all — so no Alt is injected.

### Fix 1 — press path (`electron/focus/focusContext.ts`) — pure TypeScript, live on dev reload

Before:
```ts
yieldRippleForeground();
try {
  await allowSetForegroundNative();     // <-- fires Alt into Notepad/Cursor on EVERY press
} catch { /* sidecar may be down at hotkey */ }
let raw = await getForegroundWindow();
```

After — the call is removed from the unconditional press path. It already exists in the fg-mismatch branch further down (`press_reassert=focus`), which is the only case that genuinely needs it:
```ts
yieldRippleForeground();
// NOTE: allowSetForegroundNative() is deliberately NOT called here.
// ... Alt is the menu-activation key in Win32/Electron apps ...
let raw = await getForegroundWindow();
```

Net effect: when the pin already owns the foreground (`press_reassert=skip_fg_match`, the normal case), **zero** keystrokes and zero foreground calls happen at press.

### Fix 2 — sidecar `focus_hwnd` (`ripple-native/src/send_input.rs`) — needs a rebuild

`focus_hwnd()` also Alt-tapped on its way to `SetForegroundWindow`, even when the target was **already** foreground. Guarded earlier this session:

```rust
// Already foreground: leave it alone. The Alt tap + AttachThreadInput
// ritual on an already-foreground Chrome flips it into Alt-menu
// mnemonic mode, which swallows the next Ctrl+V (failed-paste bug).
if GetForegroundWindow() == hwnd {
    return Ok(());
}
```

⚠️ **This half is in source only — the running `ripple-native.exe` is the old build.** Run once:

```
npm run native:build
```

Until that rebuild happens, the insert path can still Alt-tap Notepad/Cursor. Fix 1 stops the press-time focus loss on its own; Fix 2 stops the insert-time one.

## Crash instrumentation (from the earlier pass, kept)

The app previously had **zero** crash handlers — no `uncaughtException`, `unhandledRejection`, `render-process-gone`, `child-process-gone`, or renderer handlers — which is why any real crash produced a log that just stopped mid-word. Now installed, all writing **synchronously** (a write stream loses its buffer on hard exit) to `%LOCALAPPDATA%\Ripple\logs\`:

| Surface | Handler |
|---|---|
| Main | `uncaughtException`, `unhandledRejection`, `warning`, `exit` |
| Renderer (main + overlay, via preload) | `error`, `unhandledrejection` |
| Electron | `render-process-gone`, `child-process-gone` |
| Rust sidecar | `child.on('error')`, `child.on('exit')` |
| Lifecycle | `before-quit`, `will-quit`, `quit`, `window-all-closed` breadcrumbs |

Also closed a genuine latent crash vector: the spawned sidecar had **no `'error'` listener**. In Node an unhandled `'error'` event on a ChildProcess kills the process outright with no trace — matching the "silent exit" report. It now logs instead.

## Files changed

| File | Change |
|---|---|
| `electron/focus/focusContext.ts` | **Fix 1** — removed unconditional `allowSetForegroundNative()` from the press path (Alt injection) |
| `ripple-native/src/send_input.rs` | **Fix 2** — `focus_hwnd` early-returns when target is already foreground (needs rebuild) |
| `electron/diagnostics/crashLog.ts` | new — synchronous crash logger + breadcrumbs |
| `electron/main/index.ts` | crash handlers installed first; renderer-crash IPC; lifecycle breadcrumbs; crash-dir boot log |
| `electron/preload/index.ts` | renderer `error`/`unhandledrejection` → covers both windows, no app-code change |
| `electron/native/nativeSpawn.ts` | added missing `child.on('error')`; exit breadcrumb |

**Chrome path untouched.** No changes to `electron/automation/`, `electron/agent/dictation/`, the insert ladder, `native_text`/`clipboard_paste` strategies, or the value-change verify rules. The one change inside `electron/focus/` is the removal of the Alt-injecting call in the press path — the exact line the evidence implicates — and it *removes* a side effect rather than adding behavior.

## Verification

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit -p tsconfig.node.json`) | **PASS** — zero new errors. Only 2 pre-existing `TS2783 'blocked'` at `main/index.ts:1722,1732` in the untouched OS-test-bridge (they shifted 1701→1722 as inserts pushed them down, proving they predate this work) |
| focus / windows / dictation / insert suites | **PASS — 102/102**, 17 files (re-run after Fix 1) |
| focus / windows / dictation / insert / native suites | **PASS — 109/109**, 19 files (after crash-handler pass) |
| Sidecar rebuild (`npm run native:build`) | **NOT RUN — blocked** (see below) |
| Fresh-restart UI test ×3 | **NOT RUN — blocked** |
| Warm-session test | **NOT RUN — blocked** |

### Why the UI tests and rebuild did not run

The sandbox's command-safety classifier went offline mid-session. Narrowly allowlisted commands (`npx tsc`, `npx vitest`, `cat`) still execute — that is how the typecheck and 102/109 test results above are genuinely real — but every process-control or build command (`taskkill`, `tasklist`, `cargo build`, `npm run native:build`, launching the app) is refused with:

> `claude-opus-5 is temporarily unavailable (overloaded), so auto mode cannot determine the safety of Bash right now.`

A fresh-restart UI test requires a real kill + relaunch. Per the protocol's own rule — never claim a pass without actually running it — these are reported NOT RUN rather than assumed. I also declined to route around the safety control (e.g. spawning `taskkill` from inside a script), since deliberately bypassing a failing-closed safety mechanism is not acceptable.

## What to do next (2 minutes)

1. `npm run native:build` ← applies Fix 2; without it the insert path can still Alt-tap
2. Kill `electron.exe` + `ripple-native.exe` in Task Manager
3. `npm run dev`
4. Focus Notepad → press the hotkey → **the caret should stay in the text area** (previously the menu bar armed and focus was lost)
5. Dictate; then switch to Cursor and repeat

In the log, a healthy press now shows:
```
[ripple-focus-drift] press_reassert=skip_fg_match ...
[ripple-focus-drift] press_sequence ... fg_before=Notepad:X fg_after_overlay=Notepad:X fg_after_session_start=Notepad:X
```
All three equal, and **no** `press_reassert=focus` line — meaning nothing touched your window and no Alt was sent.

If anything still misbehaves, `%LOCALAPPDATA%\Ripple\logs\` now contains either a `crash-*.log` with a full stack trace or a `lifecycle.log` breadcrumb trail that says whether it was a crash, a normal quit, or an external kill.

## Still open / separate

- The dev-only branch in `electron/main/index.ts` (`else if (process.env.ELECTRON_RENDERER_URL)`) force-pops the main window (`setAlwaysOnTop → show → focus → moveTop`) on every dev boot while logged in. That is a real, *separate* window-jump visual event; it does not run in a packaged build. Left untouched — out of this spec's scope.
- Cursor's AI chat input exposes no UIA value, so inserts there can report `a11y_name_mismatch` and abort rather than falsely claim success. Correct-but-conservative behavior; unrelated to the Alt bug.
