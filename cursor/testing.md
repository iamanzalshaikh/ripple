You are working in a loop. Do not stop after one pass — keep iterating until the verify step passes or you hit the iteration limit.

GOAL:
Systematically execute every P0 and P1 test row in docs/RIPPLE-EDGE-CASE-MATRIX.md (the master matrix, already in the repo — read it first, do not recreate it). For each row: run the exact Steps, check for the exact Log signal, and update that row's Status column (✅ VERIFIED / ⚠️ PARTIAL / ❌ UNTESTED / 🐞 KNOWN BUG) based on REAL log output from THIS run, never from memory or assumption. Where a row is 🐞 KNOWN BUG or fails during testing, fix it — but ONLY that specific issue, using the smallest possible change.

HARD RULE — DO NOT BREAK EXISTING LOGIC:
- Before touching any file, note its current test-passing state. After any change, the SAME row plus every row already marked ✅ VERIFIED in the matrix must still pass — re-run the Quick Smoke Test (bottom of the matrix file) after every single fix, not just at the end.
- Do not refactor, rename, "clean up," or restructure any working code as a side effect of fixing something else. One row's fix must not touch files unrelated to that row unless the log signal proves the root cause lives there.
- Sections already marked ✅ VERIFIED across the board (per the matrix) are OUT OF SCOPE unless a regression is caught by the smoke test — if that happens, treat it as a P0 stop-everything issue: revert or fix immediately before continuing to new rows.
- The two rules already documented in the matrix file apply to every single test you run, no exceptions:
  1. A green/working-looking UI with a missing or wrong log line is a FAIL. Verify from logs, not appearance.
  2. Any "first dictation after launch" test requires a FULL process kill (electron.exe AND ripple-native.exe confirmed gone in Task Manager/process list) before relaunch. A hot-reload does not count and invalidates that test row.

TEST EXECUTION ORDER (follow the matrix's own priority order exactly):
1. P0 rows first, in the order listed: 1.7, 3.8, 3.14, 9.2, 9.3, 9.5, 9.6, 9.7, 13.2, 12.6, 4.9
2. Then P1 rows: 1.8, 1.9, 2.5, 3.5, 3.6, 3.7, 5.5, 5.18, 5.19, 7.1, 10.1, 10.6, 11.4
3. Only after ALL P0 and P1 rows are ✅ VERIFIED (or explicitly documented as a fixed 🐞→✅ transition), proceed to P2 rows in the order listed.
4. P3 (Section 14, 12.5) — skip entirely, out of scope, defer as the matrix itself states.

AUTOMATION — use Playwright Electron (_electron) wherever a row can be driven that way:
- Real process launch/kill, real IPC ping for liveness, internal test API to trigger dictation where real mic/hotkey input isn't available to automation (document this limitation per-row if used).
- For rows requiring REAL OS-level conditions Playwright cannot simulate (physical monitor unplug, real second speaker for diarization, real antivirus/SmartScreen environment, real second Windows user account) — mark as "MANUAL TEST REQUIRED" in the matrix, do not fake-pass it, do not skip silently. List these explicitly in the final report for the user to run by hand.
- For every automated row: capture the exact log line(s) specified in the matrix's "Log signal" column as proof, not just a pass/fail boolean.

VERIFY (must ALL be true to stop):
- [ ] Every P0 row shows ✅ VERIFIED with its exact required log signal captured and quoted in the matrix file
- [ ] Every P1 row shows ✅ VERIFIED with its exact required log signal captured and quoted, OR is explicitly marked "MANUAL TEST REQUIRED" with a one-line reason
- [ ] Zero regressions: the Quick Smoke Test (all 7 steps) passes cleanly on a run AFTER all fixes are applied — full process kill, fresh relaunch, all 7 steps, all required log lines present, zero new crash-*.log files
- [ ] Typecheck clean (tsc --noEmit — zero NEW errors vs. pre-existing baseline)
- [ ] All existing automated test suites still pass unchanged
- [ ] The matrix file itself is updated in place — Status column reflects real results from this session, not left stale
- [ ] Any row that was 🐞 KNOWN BUG and got fixed is re-tested 3x consecutively (fresh process kill each time, where the row is a first-launch test) before being marked ✅ VERIFIED — one pass is not enough for anything in the "first dictation after launch" category, this project's history proves these are intermittent

LOOP PROTOCOL — repeat each pass:
1. DISCOVER — open docs/RIPPLE-EDGE-CASE-MATRIX.md, find the next row in priority order that is not yet ✅ VERIFIED this session. Read its exact Steps and Log signal columns — do not paraphrase or assume what it's testing.
2. PLAN — if it's untested: plan how to execute it (automated via Playwright, or flag as manual). If it's a known bug: plan the smallest fix targeting the exact failure, informed by the actual log output from attempting the test, not a guess.
3. EXECUTE — run the test steps exactly as written. If fixing a bug, make the smallest change, touching only files the log evidence points to.
4. VERIFY — run the row's test again, capture the real log output, compare against the required Log signal string exactly. Then re-run the Quick Smoke Test to confirm no regression. Read actual output both times — never assume a pass.
5. DECIDE:
   - This row now passes with correct log signal AND smoke test still clean → update its Status in the matrix file to ✅ VERIFIED (or ⚠️ PARTIAL with the caveat noted, if that's genuinely the honest state) → print "ROW [#] VERIFIED — [log signal captured]" → move to next row.
   - Row requires a fix → apply it, re-test the row 3x if it's a first-launch category test, re-run smoke test, then mark verified once all pass.
   - Row cannot be automated → mark "MANUAL TEST REQUIRED" with reason, move to next row.
   - All P0+P1 rows done → print "FINAL — done" and write the report (below).
   - Not done and more rows remain → print "ITERATING — [row #], [what's still failing, exact log line or its absence]" and go to step 1.

STOP CONDITIONS:
- Success: all P0 and P1 rows are ✅ VERIFIED or explicitly MANUAL TEST REQUIRED, smoke test clean, zero regressions.
- Hard limit: after 25 iterations (this is a large matrix, not a single bug — allow more passes than a normal loop), stop regardless. Report exactly which rows are done, which are still failing with their real log evidence, and which are manual-only. Do not guess at unfinished rows.

RULES:
- Never mark a row ✅ VERIFIED without the exact log signal string from that row's own column, actually captured in this session's real output.
- Never touch a file outside what a row's own log evidence points to.
- Never skip the full-process-kill requirement for any "first dictation after launch" row — a hot-reload result for these is invalid and must be discarded, re-run properly.
- If a fix for one row appears to require touching a file also relevant to an already-✅-VERIFIED row, STOP, re-run that other row's test before proceeding, and report the cross-impact explicitly rather than assuming it's still fine.
- Don't ask the user questions mid-loop — make a reasonable assumption, note it in the report, and continue.
- If a row's expected behavior is ambiguous as written in the matrix, implement the safer interpretation (fail loud / abort+clipboard+toast over silent success) and note the assumption.

UNATTENDED FINAL REPORT — write RIPPLE-EDGE-CASE-TEST-REPORT.md in the repo root on FINAL or iteration limit, containing:
- Summary table: total P0/P1 rows, how many ✅ VERIFIED this session, how many fixed from 🐞→✅, how many MANUAL TEST REQUIRED, how many still failing
- Per-row detail for everything touched this session: row #, before status, after status, log signal captured (quoted verbatim), files changed (if any)
- Full Quick Smoke Test output from the final clean run (all 7 steps, all log lines)
- Explicit list of MANUAL TEST REQUIRED rows with the exact reason automation couldn't reach them, and what a human needs to do for each
- Any regression caught and how it was resolved
- Confirmation: matrix file updated in place, no test-only scaffolding left in production code
- Final line, always: "P2/P3 rows not attempted this session — run this loop again scoped to P2 once P0/P1 are stable in production."

Begin. Run the loop until FINAL or the iteration limit.