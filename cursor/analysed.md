ADDITIONAL PROTOCOL — AUTOMATED VISUAL VERIFICATION + UNATTENDED FINAL REPORT:

The user is away. You cannot rely on human eyes to confirm the desktop flash is gone, so you must verify it programmatically:

1. SCREENSHOT-BASED FLASH DETECTION — build a temporary test harness (delete after FINAL):
   - Write a small script (Node or PowerShell) that captures a screenshot of the primary display every ~150ms into a temp folder while a dictation test runs.
   - Drive one full first-dictation cycle after a fresh app restart (use a pre-recorded/synthesized audio input or the shortest path that triggers the full insert pipeline into a real Chrome contenteditable).
   - After the run, analyze the captured frames: compute per-frame difference; flag any frame where the foreground window disappears and the desktop/wallpaper is exposed (large luminance/content jump matching the desktop, taskbar-only frame, or >60% pixel change lasting 1–3 frames).
   - PASS = zero desktop-exposed frames across the whole cycle. FAIL = any flash frame found; save the flagged frames to the report folder as evidence and continue iterating.

2. WINDOW-STATE POLLING (backup signal, cheaper): during each test dictation, poll every 100ms: GetForegroundWindow + IsIconic(pinned hwnd) + the count of visible top-level windows (EnumWindows). Log as [ripple-test] window_poll t=… fg=… iconic=… visibleTopLevel=…. A sudden drop in visibleTopLevel or fg becoming Progman/WorkerW (the desktop) = flash detected = FAIL for that pass.

3. Add both signals to VERIFY: the 3× fresh-restart tests must each show (a) zero desktop-exposed screenshot frames AND (b) zero window_poll frames with fg=Progman/WorkerW or iconic=1 during insert.

4. UNATTENDED FINAL REPORT — when you print FINAL (or hit the iteration limit), write a single file REPORT.md in the repo root containing:
   - PASS/FAIL per verify item, including the 3 restart runs individually
   - The full log of the last first-dictation run (press_sequence through insert verify)
   - Screenshot-analysis result per run (frames captured, flash frames found: none / list)
   - Every file changed with one-line reason
   - Anything still broken, with the exact evidence line
   - Cleanup confirmation: screenshot harness and temp frames deleted, no test scaffolding left in production code paths
   The user will read REPORT.md when they return — write it so a single read answers "is it fixed, and how do you know."

RULES ADDITIONS:
- The screenshot harness is test-only: it must never ship in the app, never run outside the loop, and must be fully removed before FINAL.
- If screenshot capture fails on this machine for any reason, say so explicitly in REPORT.md and fall back to the window_poll signal — never silently skip visual verification and claim it passed.
- Even with all automated checks green, the last line of REPORT.md must be: "Recommended: one human-observed recorded run (fresh launch → first dictation) as final confirmation."