You are working in a loop. Do not stop after one pass — keep iterating until the verify step passes or you hit the iteration limit.

GOAL:
Fix the desktop-flash + failed-paste bug: on the FIRST dictation after app launch, ~1.2s mid-flow (around insert time) ALL windows vanish and the bare desktop shows, then windows return; the clipboard paste lands nowhere (verify shows field value byte-identical before/after — still the placeholder) yet the ladder falsely reports status=ok/inserted=true. Implement the full spec already provided: (1) audit all SendInput sequences for stray/stuck Win-key or missing key-ups on every code path including error paths; (2) log modifiers_before_send (GetAsyncKeyState for Win/Ctrl/Shift/Alt) before every send, and refuse to send while Win is down (wait 300ms → abort with toast+clipboard); (3) target_state gate before every send (IsWindowVisible/IsIconic on pinned hwnd — never paste at a hidden/minimized target; wait 500ms → abort with toast+clipboard); (4) audit our own dictation-flow code for any minimize/hide/ShowWindow/SetWindowPos calls that could cascade a desktop flash, including the WS_EX_NOACTIVATE toggle timing on a visible window; (5) implement the pending paste-landing spec: composer_focus caret placement always runs before browser clipboard paste even on the fg-match fast path; a11y_name_mismatch acceptance requires value_after ≠ value_before or fragment match — byte-identical value = NOT landed → one retry after explicit composer click → else insert_aborted:paste_no_effect + toast + clipboard; clipboard_check read-back + paste_send result logging.

DO NOT REGRESS: the press-path fix (press_sequence all-equal snapshots, main_suppress branch guards, WS_EX_NOACTIVATE helper, live_fg pin). No changes to press-path behavior.

VERIFY (must ALL be true to stop):
- [ ] Typecheck clean in all touched files (tsc --noEmit — pre-existing planner/test drift failures excluded, ZERO new errors)
- [ ] All focus/windows/dictation/transform/insert test suites pass (npm test for those suites)
- [ ] New unit tests exist and pass for: modifier gate (win=1 → refuse+abort), target-state gate (iconic → wait→abort), value-change acceptance rule (identical value → retry once → abort; changed value → accept; late-landing → no double insert)
- [ ] FRESH-RESTART UI TEST (the critical one — the bug is first-run-only): fully quit the app (kill the process, not just reload), relaunch, and on the VERY FIRST dictation into a Chrome contenteditable (Claude composer or WhatsApp Web): (a) log shows press_sequence with all three snapshots equal; (b) log shows modifiers_before_send win=0, target_state visible=1 iconic=0, composer_focus ok=1, clipboard_check with correct len; (c) verify passes on value CHANGE (no "accepting committed insert" with identical value anywhere in the log); (d) the dictated text is confirmed present in the field via the verify_after value containing a fragment of it
- [ ] Repeat the fresh-restart UI test 3 times in a row (quit → relaunch → first dictation) — all 3 first-dictations must pass criteria (a)–(d). One pass is not enough; this bug is intermittent and first-run-biased
- [ ] A second dictation in the same session (no restart) also lands correctly — no regression on warm runs
- [ ] No console.log left in touched files; all new logging uses the existing [ripple-*] logger channels

LOOP PROTOCOL — repeat each pass:
1. DISCOVER — read the current state of the relevant files (send_input.rs, win32Bridge.ts, inputStrategy.ts, smartInsert.ts, insertText.ts, focusContext.ts, overlay.ts, mainWindow.ts, compose adapters) and the latest test/UI-run logs; note exactly what's failing or missing.
2. PLAN — pick the single highest-impact fix. Don't try to fix everything at once.
3. EXECUTE — make the smallest change that addresses it.
4. VERIFY — actually run the commands AND the fresh-restart UI test (kill app → relaunch → first dictation → read the emitted log lines). Don't assume anything passes — run it and read the real log output.
5. DECIDE:
   - If every VERIFY item passes → print "FINAL — done" and summarize what changed, listing every file touched and every new log line added.
   - If not → print "ITERATING — [what's still broken, with the exact failing log line or test name]" and go to step 1.

STOP CONDITIONS:
- Success: all VERIFY items pass, including 3/3 fresh-restart first-dictation passes.
- Hard limit: after 8 iterations, stop regardless, report what's fixed and what isn't, include the latest full first-dictation log, and don't guess further.

RULES:
- Never claim success without actually running the verify commands and the fresh-restart UI test — the log lines (modifiers_before_send, target_state, composer_focus, clipboard_check, value-change verify) are the proof, not assumptions.
- RESTART THE APP FULLY before every UI verification — this bug manifests on the FIRST dictation after launch. A warm-session test proves nothing.
- Don't ask me questions mid-loop — make a reasonable assumption, note it, and continue.
- Fix the highest-impact failure first, not the easiest one.
- If the desktop flash still occurs during any UI test: capture the log's modifiers_before_send and target_state lines bracketing that moment — that output is a required deliverable even if the fix isn't complete, because it names the true trigger.
- Never weaken an abort into an acceptance to make a test pass — a false success is a failed verify, full stop.

Begin. Run the loop until FINAL or the iteration limit.