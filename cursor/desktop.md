You are working in a loop. Do not stop after one pass — keep iterating until the verify step passes or you hit the iteration limit.

GOAL:
Fix a crash/exit bug: on the FIRST dictation into a native desktop app (Notepad, Cursor, or similar — NOT Chrome/browser targets, which are confirmed working) after a fresh app launch, the Ripple app itself closes/exits and does not reopen or recover on its own. It only happens the first time after launch — subsequent dictations in the same session work fine. Evidence so far: the last captured log (__built_in_3_44s.txt) shows a fully clean Notepad dictation (press_sequence all-equal, modifiers_before_send win=0, target_state visible=1, strategy=native_text status=ok, inserted=true, telemetry success) — then the very next line, a focus-captured event for switching to Cursor, is CUT OFF MID-WORD ("...youtube=false l") with nothing after it: no shutdown log, no error, no exception, the file just stops. This is the signature of an abrupt process crash, not a graceful close, and not related to the insert/focus logic (which worked correctly right up to the crash point).

DO NOT REGRESS OR MODIFY: any focus/insert/dictation logic already confirmed working — press_sequence timing, main_suppress branches, hotkey_pin live-fg pinning, modifiers_before_send gate, target_state gate, native_text/clipboard_paste strategies, the value-change verify/acceptance rules, or any file under electron/focus/, electron/automation/, electron/agent/dictation/ unless the crash is proven to originate inside one of them. Treat all of that as known-good and out of scope unless evidence says otherwise.

VERIFY (must ALL be true to stop):
- [ ] Root cause of the crash is identified with an actual stack trace or exception log, not a guess
- [ ] A global crash handler exists and is confirmed firing: main process (process.on('uncaughtException'), process.on('unhandledRejection')) and renderer process (window.onerror, unhandledrejection) all write a full stack trace to a persistent crash log file (e.g. logs/crash-<timestamp>.log) BEFORE the process exits — this must survive even if the log stream itself is being written to when the crash happens
- [ ] The actual root cause (once found via the crash log) is fixed
- [ ] Typecheck clean (tsc --noEmit — zero NEW errors vs. pre-existing baseline)
- [ ] All existing focus/windows/dictation/insert test suites still pass unchanged
- [ ] FRESH-RESTART UI TEST (critical — bug is first-run-only): fully kill the app process (not just close the window — confirm via Task Manager / process list that ripple-desktop.exe and the native sidecar are both gone), relaunch, and on the VERY FIRST dictation into Notepad, followed immediately by switching focus to Cursor and dictating again: the app must still be running and responsive after both. No crash, no silent exit, no need to relaunch.
- [ ] Repeat the fresh-restart UI test 3 times in a row (full kill → relaunch → Notepad dictation → switch to Cursor → Cursor dictation) — all 3 must pass with zero crashes. One pass is not enough; this bug is intermittent/first-run-biased like the others we've hunted in this app.
- [ ] A warm-session test (no restart, 5+ consecutive dictations across Notepad/Cursor/Chrome mixed) shows no crash either — confirms the fix isn't just delaying the crash past the "first" dictation

LOOP PROTOCOL — repeat each pass:
1. DISCOVER — read the current state of the crash-handling code (or lack of it) in the main process entry point (electron/main/index.ts) and any native sidecar process-lifecycle code (ripple-native process spawn/monitor logic). Check whether ANY crash handler currently exists. Read the most recent crash log if one now exists from a prior pass.
2. PLAN — if no crash handler exists yet, that is ALWAYS the highest-impact first fix (you cannot diagnose what you can't see). Once a crash handler is in place and has captured a real stack trace, plan the fix for whatever that stack trace actually shows — do not guess at a root cause before you have this evidence.
3. EXECUTE — make the smallest change that addresses it. If adding the crash handler, add it FIRST as its own pass — do not combine "add crash visibility" and "fix the guessed cause" in the same pass, since you don't yet know the real cause.
4. VERIFY — actually run typecheck, the test suites, AND the fresh-restart UI test (real kill, real relaunch, real dictation). Read the actual crash log file content if a crash still occurs — do not assume, read it.
5. DECIDE:
   - If every VERIFY item passes → print "FINAL — done" and summarize what changed, including the exact root cause found (quote the stack trace) and the fix applied.
   - If not → print "ITERATING — [what's still broken, with the exact stack trace or log line if a crash occurred this pass]" and go to step 1.

STOP CONDITIONS:
- Success: all VERIFY items pass, including 3/3 fresh-restart tests with zero crashes.
- Hard limit: after 8 iterations, stop regardless. If the crash is still unresolved, your final report MUST include the full captured stack trace from the crash handler (even if you couldn't fix the underlying cause yet) — a real stack trace with no fix beats no stack trace at all, since it lets a human or a follow-up pass target the actual line.

RULES:
- Never claim success without actually running the fresh-restart UI test with a REAL process kill and REAL relaunch — a warm reload or dev-server hot-reload does not reproduce this bug and does not count.
- Do not guess at the crash cause and patch speculatively before you have a real stack trace from the crash handler. Adding visibility comes before fixing.
- Do not touch, refactor, or "clean up" any file in the focus/insert/dictation pipeline unless the crash log's stack trace points directly into that file — these are confirmed working and any incidental change risks reintroducing bugs we already spent significant effort fixing.
- Don't ask me questions mid-loop — make a reasonable assumption, note it, and continue.
- If the crash appears to originate in the native Rust sidecar (ripple-native.exe) rather than the Electron/Node process, capture that separately — Rust panics need their own handler (panic hook writing to the same crash log) since a JS uncaughtException handler won't catch a native process crash.
- Check specifically whether the crash correlates with the focus-target SWITCH event (Notepad → Cursor) itself, since that's the exact point the log cut off — pay particular attention to any code that runs on a focus-change/window-switch event, not just code that runs during dictation.

ADDITIONAL PROTOCOL — UNATTENDED FINAL REPORT:
When you print FINAL (or hit the iteration limit), write a single file CRASH-REPORT.md in the repo root containing:
- Whether a crash handler was successfully added and confirmed firing
- The exact root cause (full stack trace, file, line) if found — or "not yet captured" if still unknown
- The fix applied, if any, with before/after code snippets
- Results of all 3 fresh-restart test runs individually (pass/fail, with log excerpts)
- Result of the warm-session test
- Anything still broken or suspicious, even if it didn't block VERIFY
- Confirmation that no focus/insert/dictation files were touched unless justified by the stack trace (list any exceptions with reasoning)
The user will read CRASH-REPORT.md when they return.

Begin. Run the loop until FINAL or the iteration limit.