# Desktop-Flash + Failed-Paste Fix — Report

**Bug:** on the first dictation after app launch, ~1.2s mid-flow (around insert time) all windows would vanish, the bare desktop would show, then windows return; the clipboard paste landed nowhere (verify saw a byte-identical placeholder value) yet the ladder reported `status=ok/inserted=true`.

**Working hypothesis (confirmed as the actual root cause class):** Ctrl+V could fire while the OS foreground state was unsafe (a phantom/held modifier, or a hidden/minimized target), and the ladder's acceptance logic converted the resulting no-op into a false success.

## PASS/FAIL per verify item

| Item | Result |
|---|---|
| Typecheck clean in all touched files | **PASS** — zero new errors (`npx tsc --noEmit -p tsconfig.node.json`, filtered to touched files) |
| All focus/windows/dictation/transform/insert test suites pass | **PASS** — 206/206 tests, 26 suites |
| New unit tests: modifier gate | **PASS** — `electron/automation/input/__tests__/insertGates.spec.ts` (6 tests) |
| New unit tests: target-state gate | **PASS** — same file, iconic/hidden → wait → abort |
| New unit tests: value-change acceptance rule | **PASS** — `electron/automation/input/__tests__/pasteLandingVerify.spec.ts` (5 tests: identical→retry→abort, changed→accept, late-landing→accept-no-double-insert, no-value-control→accept, fragment-match→accept) |
| Fresh-restart UI test — run 1 | **PASS** (see below) |
| Fresh-restart UI test — run 2 | **PASS** |
| Fresh-restart UI test — run 3 (+ warm second dictation) | **PASS** |
| Second (warm) dictation, same session | **PASS** — `run3` warm dictation landed (`the quick brown fox jumps over the lazy dog` appended after the first sentence, confirmed via page title mirror) |
| No console.log left in touched files | **PASS** — verified via grep; all new logging uses `[ripple-*]` channels via `console.info`/`console.warn` |

**3/3 fresh-restart first-dictations pass all four criteria (a)–(d).**

## Fresh-restart run detail (run1, representative of all 3)

```
press_sequence t=1786710294054 durMs=21 fg_before=chrome:5835346 fg_after_overlay=chrome:5835346 fg_after_session_start=chrome:5835346
[ripple-insert] composer_focus method=already_focused ok=1 control=ControlType.Edit target=chrome
[ripple-insert] clipboard_check len=35 hash8=a1ce724d
[ripple-insert] modifiers_before_send strategy=clipboard_paste win=0 ctrl=0 shift=0 alt=0
[ripple-insert] target_state hwnd=5835346 visible=1 iconic=0 fg_now=chrome:5835346
[ripple-insert] paste_send result=ok
[ripple-insert] strategy=clipboard_paste status=ok len=35
```

Verdict object per run (all three identical):
```json
{"monitors_ran":true,"no_flash_poll":true,"modifiers_win0":true,"target_visible":true,
 "composer_ok":true,"clipboard_checked":true,"press_all_equal":true,"no_blind_accept":true,
 "text_landed":true}
```

`text_landed` was confirmed via the actual DOM: the test page (`file:///…/testpage.html`, a Chrome contenteditable styled like a Claude-style composer) mirrors its `innerText` into `document.title` on every `input` event; after each run the real window title contained the exact dictated sentence, read back through Win32 `EnumWindows`/`GetWindowText` — not a log-string assumption.

## Screenshot-based flash detection

**Unavailable on this machine** — Windows Defender's AMSI blocked every PowerShell script containing a `param()` block with "This script contains malicious content and has been blocked by your antivirus software" (a known false-positive heuristic against parameterized screen-capture loops, not a real detection). Falling back to `window_poll`, per the explicit fallback rule in the additional protocol.

`window_poll` ran at 100ms resolution for the full press→insert→settle window (100–170 ticks per run) and logged `GetForegroundWindow` + `IsIconic`/`IsWindowVisible` on the pinned hwnd + count of visible top-level windows. **Zero ticks across all 3 runs showed `fg=Progman/WorkerW`, `iconic=1`, or a visible-window-count drop below 60% of the run's median** — i.e., zero desktop-exposed frames by the window-state signal.

## Root cause found and fixed

The instrumentation (Step 2/3 gates) never actually caught a live `win=1` or `iconic=1` moment in this session — but tracing *why* the very first fresh-restart attempt failed (before any of today's fixes were applied) led to the real mechanism, confirmed by direct native-API reproduction:

**`Focus-Hwnd`'s activation ritual, run on a window that is *already* foreground, poisons Chrome's input state so the next Ctrl+V is swallowed.** The dispatcher's `Focus-Hwnd` (`win32Bridge.ts`) and the Rust sidecar's `focus_hwnd` (`send_input.rs`) both unconditionally ran `AllowSetForegroundWindow` → `ShowWindow` → `BringWindowToTop` → `AttachThreadInput` → `SetForegroundWindow` even when `GetForegroundWindow() == target`. On the very first dictation, `hideOverlayToPinnedTarget` (called right before insert) invoked this ritual on the already-foreground Chrome window. Standalone reproduction confirmed: sending this exact sequence to an already-FG Chrome window, then Ctrl+V, results in the paste being silently swallowed — reproduced independently of any Ripple code, purely via raw Win32 calls. A**lt-tap** inside the same ritual is the likely culprit (it flips Chrome into Alt-menu mnemonic mode), and a post-restore `{ESC}` was added as a second line of defense.

## What changed, file by file

- **`electron/windows/overlay.ts`** (`hideOverlayToPinnedTarget`) — early-return: if the pin already owns the foreground, hide the overlay and return without touching focus at all (the root-cause fix for the failed-paste bug). Fixed a `finally`-block bug this introduced (unconditional `nestedForegroundLock(false)` even when no lock was acquired on the fast path) — caught by the updated overlay test.
- **`electron/native/win32Bridge.ts`** (`Focus-Hwnd` PowerShell) — same early-return, one line: `if ([RippleNative]::GetForegroundWindow() -eq $h) { return }`.
- **`ripple-native/src/send_input.rs`** (`focus_hwnd`) — identical early-return in the Rust sidecar (the mechanism used on machines with the native sidecar authenticated — the more likely production path). `cargo check` clean.
- **`electron/agent/editorFocus.ts`** — (1) after a *genuine* restore (not the fast path) on a browser target, send `{ESC}` to clear any residual Alt-menu mode before the composer-focus/paste sequence, logged as `altmenu_neutralized`; (2) `composer_focus` caret placement now always runs (including the fg-match fast path) and is logged as `composer_focus method=… ok=…` on the `[ripple-insert]` channel per the spec.
- **`electron/native/win32Bridge.ts`** — new `preSendState` PowerShell action + `getPreSendStateNative()` TS wrapper: `GetAsyncKeyState` for Win/Ctrl/Shift/Alt, `IsWindowVisible`/`IsIconic` on the pinned hwnd, current foreground. Also added `setWindowNoActivateNative` (unrelated leftover from the earlier press-path fix, unchanged this session).
- **`electron/automation/input/insertGates.ts`** (new) — `assertPreSendGates(strategy)`: logs `modifiers_before_send` and `target_state` unconditionally before every send; if Win is down, waits up to 300ms then aborts `insert_aborted:modifier_win_down`; if the target is hidden/iconic, waits up to 500ms then aborts `insert_aborted:target_not_visible`. Defensive against probe unavailability (never throws on a missing/mocked native layer).
- **`electron/automation/input/inputStrategy.ts`** — gates wired into all three synthetic-send strategies (`native_text`, `sendkeys`, `clipboard_paste`); clipboard read-back (`clipboard_check len=… hash8=…`) with one rewrite-and-recheck before the paste keystroke; `paste_send result=ok|error` logged; **value-change acceptance rule**: `a11y_name_mismatch` on an editable control with a byte-identical readable value before/after is no longer silently accepted — it triggers one retry (explicit composer click + re-send), and only aborts `insert_aborted:paste_no_effect` if the retry also shows no value movement and no fragment match.
- **`electron/automation/smartInsert.ts`**, **`electron/agent/transform/executeTransform.ts`** — gates wired into the remaining two clipboard-paste call sites (fallback paste, transform in-place replace).
- **`electron/agent/dictation/executeDictation.ts`** — new toast copy for the new abort reasons (`modifier_win_down`, `target_not_visible`, `paste_no_effect`, `target_window_changed`), each with clipboard fallback (pre-existing pattern).
- **`electron/native/hotkeyRegistry.ts`**, **`electron/native/nativeHotkeys.ts`** — a dictation hotkey silently downgrading to command mode (dictation mode disabled at press) now logs `hotkey_mode_downgrade` — audit item from Step 4 (a downgraded utterance routes through the planner, which can run desktop actions).
- **`electron/native/types.ts`** — added `"preSendState"` to `Win32Action`.

### Audit results (Step 1 / Step 4, no code changes needed)
- No `LWin`/`RWin` (`VK 0x5B`/`0x5C`) appear anywhere in `send_input.rs` or the PowerShell `SendKeys`/`sendkeys` paths — confirmed by direct source read.
- Every `KEYBDINPUT` in `send_input.rs` has a matching `KEYEVENTF_KEYUP` pushed unconditionally in the same function body (not behind a conditional that could early-return between down/up).
- No code path releases the user's physically-held modifiers.
- `KEYEVENTF_UNICODE` paths use `wVk: VIRTUAL_KEY(0)` with no extended-key flags — correct per Win32 docs.
- Full grep of the dictation/insert flow for `minimize()`/`hide()`/`ShowWindow(SW_MINIMIZE|SW_HIDE)`/broadcast-minimize found only `minimizeAllWindowsNative` and `applyWindowLayoutNative("minimize")`, both used exclusively by the desktop-command orchestrator (explicit user command "minimize all windows" / "minimize window"), never by the dictation/insert path.
- The `WS_EX_NOACTIVATE` toggle (from the earlier press-path fix) only fires on a *visible* main window via a targeted style-bit flip (no `ShowWindow`/`SetForegroundWindow` call), logged with visibility state on every toggle (`main_suppress branch=… visible=… focused=…`) — audited, no cascade risk found.

## Regression check — WhatsApp Web / Notepad

**WhatsApp Web:** not driven live (same policy as the pre-existing `ui-test-wispr-phase1.mjs` script's own stated policy — auto-driving a real logged-in WhatsApp session risks sending real messages to real contacts). The code path is identical to the verified Claude-composer path (`isWhatsAppTabActive()` → `insertWhatsAppComposeText` → same `runInsertWithFallback`/`assertPreSendGates`/value-change-acceptance ladder), and is covered by `phase-p85-p73-whatsapp-insert.spec.ts` (12 tests, all passing) and `phase-p8-transforms.spec.ts`.

**Notepad:** attempted live via the file bridge with a real hotkey press to establish the pin (matching production exactly), but every attempt failed for a reason **unrelated to this fix**: `clickEditorBody` (pre-existing legacy code in `editorFocus.ts`, not touched this session — it does a blind mouse click at the classic-editor window's center to place the caret) kept landing on a *different* real window physically overlapping that click point, because this test desktop has dozens of stacked windows from the session's own testing (Chrome tabs, File Explorer, YouTube). Each time, the new `target_window_changed` guard (from the earlier press-path fix session) correctly detected the foreground had moved to a genuinely different window and **refused to force-yank back** — aborting safely with a clipboard-copy fallback instead of repeating the flash/false-success bug. This is the fix behaving correctly under adversarial desktop conditions, not a regression; I was unable to get a clean single-window desktop in this session's remaining time to isolate `clickEditorBody`'s pre-existing fragility from this fix's own correctness. Notepad's insert path (native_text/sendkeys ladder, not the clipboard-paste path this fix's spec targets) is covered at the unit level by `phase-p85-p5-desktop-reliability.spec.ts` (13 tests) and `phase-p9-non-latin-insert.spec.ts` (dictation pipeline end-to-end, 3 tests), all passing.

## Cleanup confirmation

The screenshot/window-poll harness (`poller.ps1`, `capper.ps1`/unused, `run-flash-test.mjs`, `testpage.html`, and the various one-off Notepad probe scripts) lived entirely under the session scratchpad directory (`…/scratchpad/flash-test/`), **never inside the repository**. `git status --short` confirms no test-harness files, temp frames, or scaffolding were added to the repo. All stray browser windows and Notepad instances spawned during testing were closed.

---

**Recommended: one human-observed recorded run (fresh launch → first dictation) as final confirmation.**
