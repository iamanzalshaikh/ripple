You are working in a loop. Do not stop after one pass — keep iterating until the verify step passes or you hit the iteration limit.

GOAL:
Fix the crash/close bug: on the FIRST dictation into a native desktop app (Notepad, Cursor) after a FRESH app restart, the Ripple app closes/stops responding and does not recover on its own. It only happens the first time after restart — subsequent dictations in the same session work fine. A crash handler already exists (C:\Users\ANZAL\AppData\Local\Ripple\logs) — use it, and use the Playwright Electron harness (build if not already present) to automate the restart→dictate→verify cycle instead of relying on manual testing.

DO NOT REGRESS OR MODIFY: any focus/insert/dictation logic already confirmed working — press_sequence timing, main_suppress branches, hotkey_pin live-fg pinning, modifiers_before_send gate, target_state gate, native_text/clipboard_paste strategies, value-change verify/acceptance rules, or any file under electron/focus/, electron/automation/, electron/agent/dictation/ — unless a captured crash stack trace points directly into one of them.

ADDITIONAL PROTOCOL — AUTOMATED CRASH + VISUAL VERIFICATION (user is away, no human eyes available):

You cannot rely on the user to confirm the app is still alive or to say whether it visibly closed. Verify programmatically:

1. PROCESS-LIVENESS DETECTION (primary signal):
   - Using the Playwright `_electron` harness: after each fresh-restart dictation cycle, assert `electronApp.process().killed === false` and confirm the main window responds to a simple IPC ping/pong.
   - Also poll the OS process list every 250ms for the duration of the test (`ripple-desktop.exe` / `ripple-native.exe` by name) — log `[ripple-test] process_poll t=… ripple_desktop_alive=1|0 ripple_native_alive=1|0`. If either drops to 0 and does not return within 2s, that pass FAILS immediately.
   - Check the crash-logs directory (`C:\Users\ANZAL\AppData\Local\Ripple\logs`) for any new file created during the test window — if one appears, FAIL that pass and attach its full content to the report, even if the process technically survived (crash-and-silent-respawn still counts as a failure).

2. SCREENSHOT-BASED VISUAL VERIFICATION (secondary signal, same method as our prior flash-detection round):
   - Capture a screenshot of the primary display every ~150ms for the full duration of each fresh-restart dictation cycle (temporary test-only script, delete after FINAL).
   - Drive the cycle: kill app → relaunch → wait for boot-ready → trigger dictation into Notepad (via internal test API / IPC, since real mic audio isn't available) → switch OS foreground to Cursor → trigger a second dictation.
   - Analyze frames for: (a) the Ripple app UI vanishing entirely with no window taking its place (blank/desktop exposed where the app should be), (b) the target app (Notepad/Cursor) itself disappearing unexpectedly, (c) any prolonged (>1s) frozen frame indicating a hang rather than a clean response.
   - PASS = zero anomalous frames. FAIL = any found; save flagged frames to the report folder as evidence.

3. WINDOW-STATE POLLING (backup signal, cheaper, same as before): every 100ms during the test — GetForegroundWindow + IsIconic(target hwnd) + count of visible top-level windows (EnumWindows). Log `[ripple-test] window_poll t=… fg=… iconic=… visibleTopLevel=…`. A sudden drop to zero visible top-level windows, or fg becoming Progman/WorkerW right as the app should be responding, counts as FAIL for that pass.

4. Combine all three signals into VERIFY: each of the 3 fresh-restart runs must show (a) process stayed alive with zero new crash-log files, (b) zero anomalous screenshot frames, (c) zero bad window_poll frames.

VERIFY (must ALL be true to stop):
- [ ] Playwright Electron harness exists: real `_electron.launch()` of the actual app, real kill+relaunch, dictation triggered via internal test API (mic/hotkey not available to Playwright — document this limitation explicitly in the report)
- [ ] Root cause identified with an actual stack trace (from the crash handler) or definitive proof of NO crash (process-liveness + screenshot + window_poll all clean) — not a guess either way
- [ ] Typecheck clean (tsc --noEmit — zero NEW errors vs. pre-existing baseline)
- [ ] All existing focus/windows/dictation/insert test suites still pass unchanged
- [ ] 3 consecutive fresh-restart runs (real process kill → relaunch → Notepad dictation → switch to Cursor → Cursor dictation) each pass all three signals: process-liveness, screenshot, window_poll
- [ ] A warm-session variant (no restart, 5+ consecutive dictations mixed Notepad/Cursor/Chrome) also shows zero crashes and zero new crash-log files
- [ ] If a real crash reproduces at any point: it is fixed, and the fix is re-verified through all 3 restart runs again from a clean slate

LOOP PROTOCOL — repeat each pass:
1. DISCOVER — if the Playwright harness / screenshot script doesn't exist yet, build it (this is the plan for pass 1). Otherwise, read the last run's process_poll, window_poll, screenshot analysis, and any crash log captured.
2. PLAN — no crash log yet + all runs clean → keep running (intermittent bugs may not repro every pass; note explicitly if 10 consecutive clean runs occur — that's real data, not proof of nothing). Crash log captured → read the real stack trace, plan the actual fix targeting that line only.
3. EXECUTE — smallest change addressing the current highest-impact item.
4. VERIFY — run typecheck, existing suites, and the full 3-signal fresh-restart test. Read actual output; never assume.
5. DECIDE:
   - All VERIFY items pass → print "FINAL — done", write REPORT.md, summarize root cause (or definitive no-crash finding) and fix.
   - Not yet → print "ITERATING — [exact signal that failed: process_poll / screenshot frame / window_poll / stack trace]" and go to step 1.

STOP CONDITIONS:
- Success: all VERIFY items pass, including 3/3 fully clean fresh-restart runs across all three signals.
- Hard limit: after 8 iterations, stop regardless. If never reproduced despite repeated attempts, report that explicitly — it's a meaningful finding, not a failure to hide. If reproduced but unfixed, the full stack trace is mandatory in the report.

RULES:
- Never claim success without actually running the full 3-signal automated test — screenshots must be real captured frames, process polling must be real OS process checks, not assumptions.
- The screenshot harness and any test-only scripts are TEST-ONLY: never ship in the app, never run outside the loop, fully removed before FINAL.
- If screenshot capture fails on this machine for any reason, say so explicitly in REPORT.md and rely on process-liveness + window_poll instead — never silently skip a signal and claim it passed.
- Do not touch, refactor, or "clean up" any confirmed-working file unless a captured stack trace points directly into it.
- Don't ask the user questions mid-loop — they are away. Make a reasonable assumption, note it, continue.
- If the crash could originate in the native Rust sidecar rather than Node/Electron, capture that separately (Rust panic hook → same crash log) since Playwright/JS-side checks alone won't catch a native process dying silently.

UNATTENDED FINAL REPORT — write REPORT.md in the repo root on FINAL or iteration limit, containing:
- PASS/FAIL per verify item, including all 3 restart runs individually (each signal separately: process-liveness / screenshot / window_poll)
- The full log of the last fresh-restart cycle (press_sequence through insert verify, plus process_poll and window_poll traces)
- Screenshot-analysis result per run (frames captured, anomalous frames found: none / list, saved evidence paths)
- Whether a real crash was ever reproduced; if yes, full stack trace and the fix; if no, say so explicitly as a real finding
- Every file