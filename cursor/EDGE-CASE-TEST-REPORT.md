# Edge Case Test Report — P0 + P1 pass

> ## Third pass — 8 more rows, 5 real bugs found
>
> Rows closed: **1.9, 2.5, 6.2, 6.3, 6.5, 6.6, 6.9, 13.6**. Five were genuine
> production defects, each found by a test written to *measure* the behaviour
> rather than assert the behaviour I hoped for.
>
> | Row | Bug | Why it mattered |
> |---|---|---|
> | **1.9** | Two overlapping inserts **interleaved their characters** — measured 5 alternating runs instead of 2 | Press the hotkey again while a long dictation is still being sent in 60-char chunks and both sentences arrive shredded into each other |
> | **6.2** | A later correction rule re-corrected an **earlier rule's output**: `"ana maria"` → `Ana-María` → **`Anna-María`** | Silent corruption for anyone whose dictionary has one entry that is a word inside another's result |
> | **6.6** | JS `\b` is ASCII-only, so `\bjosé\b` never matched | **Every non-ASCII dictionary entry was dead** — added, listed in the UI, never fired |
> | **6.3** | Hard-coded `LIMIT 100` on corrections | Past 100 entries the oldest silently stopped working while still shown in the dictionary UI |
> | **13.6** | `stt_raw`, `command_execute`, `NLU preprocess` and the GPT-intent log printed the transcript **verbatim in production builds** | Every dictated word — messages, passwords, notes — printed to the console in shipped builds |
>
> **Fixes.** Inserts are serialized through a bounded queue (15 s cap, so a
> wedged send can never permanently block dictation, and a single insert is
> never delayed). `applyCorrectionsToUtterance` is now a single pass that
> matches every rule against the *original* text and splices once — cascades are
> structurally impossible — with unicode-aware boundaries and the cap raised to
> 2000. Transcript logging keeps its stage markers (so "did we hear anything?"
> stays diagnosable) but logs `text_len=` instead of content unless
> `RIPPLE_TRANSCRIPT_DEBUG=1`.
>
> **Row 2.5** needed no fix: a destroyed hwnd already aborts every strategy with
> `insert_aborted:target_not_visible`, the text is rescued to the clipboard with
> a toast, and a transient blip does not false-abort. Now covered by tests.
>
> **Regression evidence.** tsc **221 = baseline**, unchanged. Changed +
> protected surfaces: **185/185 across 27 files** (`automation/input`,
> `automation/actions`, `windows`, `focus`, `agent/dictation`, `automation/voice`,
> storage). Because the correction engine feeds the planner, I A/B'd it by
> restoring the old implementation and re-running the planner/agent suites:
> **33 failed / 1048 passed both ways** — identical, so zero regressions. Full
> suite 88 failed / 3247 passed; every failing file is a pre-existing
> `voice/nlu` / planner / shell suite, none touched here, and those suites are
> flaky run-to-run (the same set reported 84 and 88 on consecutive runs).
>
> **New specs:** `correctionEdgeCases.spec.ts` (8), `concurrentInsert.spec.ts` (4),
> `windowClosedMidDictation.spec.ts` (7), `transcriptLogPrivacy.spec.ts` (6).
>
> **Not touched:** `electron/focus/**`, press path, `hotkey_pin`,
> `main_suppress`, `press_sequence`, strategy ordering, screen-bias logic.
> The insert change adds a queue *around* the ladder; it does not alter focus
> behaviour, strategy order, or any gate.
>
> ### Live run on a fresh process — what it did and did not prove
>
> ```
> BOOT=READY            ALIVE=true            NEW_CRASHES=0
> QUEUE_TIMEOUTS=0      "main window open" absent (Row 1.7 still holding)
> [ripple-native] hotkey owned by sidecar (Electron backup not needed)
> DICTATE1 → insert_aborted:target_window_changed (finalText preserved)
> DICTATE2 → insert_aborted:target_window_changed (finalText preserved)
> ```
>
> **Proved live:** the app boots and stays alive with the queue in place, zero
> crash logs, zero queue timeouts, and two *sequential* dictations each returned
> promptly — i.e. the queue drains correctly and never wedges. The safety aborts
> fired correctly and preserved the text rather than dropping it.
>
> **Not proved live, stated plainly:** no text was actually inserted, because
> this environment still refuses to hand automation a stable foreground target
> (`target_window_changed` on every attempt; Notepad's UIA `AutomationElement`
> also failed to load in the harness). This is the same limitation documented in
> the P1 addendum below, not a new symptom.
>
> Two consequences worth being explicit about:
> - **Concurrency could not be driven live at all** — the file test-bridge is a
>   single-slot file, so the second request overwrites the first before the app
>   reads it. Row 1.9 rests on `concurrentInsert.spec.ts`, which drives the real
>   `runInsertWithFallback` with real chunking (not a mocked ladder).
> - **One manual check is still worth doing before you ship:** dictate a long
>   sentence into WhatsApp/Chrome, press the hotkey again mid-insert, and confirm
>   the two sentences arrive whole and in order.


> **P1 addendum (second pass).** Additionally fixed/verified: **10.1** hotkey log messaging, **1.8** rapid double-press, **10.6** Escape-then-repress re-pins, **3.7** 500+ char integrity. Final smoke on a fresh process:
> ```
> STEP1_boot=READY  FOCUS_KEPT=True
> STEP2_dictate=Final production reader verification sentence.
> STEP3_clipboard='USER_CLIPBOARD_SENTINEL'
> STEP4_new_crash_logs=0     STEP5_alive=5
> [ripple-native] hotkey owned by sidecar (Electron backup not needed): Shift+Space
> [ripple-insert] strategy=native_text status=ok len=46
> ```
> Final numbers: **tsc 221 = baseline**, core suites **146/146**, full suite **84 failed / 3226 passed** (baseline 126/3094 — improvement; all remaining failures are pre-existing NLU/planner/shell suites, several of which are flaky run-to-run).
>
> **Live UI automation limits on this machine (honest):** Windows repeatedly refused programmatic foreground changes (`SetForegroundWindow` → `WA_FG=False`), Win11 Notepad churns its window via session-restore (`MainWindowHandle=0` mid-test), and Defender AMSI blocks screen-capture scripts. So rows 3.5/3.6 (caret position, selected text) and 2.5 (window closed mid-send) could **not** be driven end-to-end and remain MANUAL. Everything marked "(code path)" is proven against the real implementation via tests, not mocked-away logic.

---



**Matrix:** `cursor/PRODUCTION-EDGE-CASES.md` (updated in place)
**Constraint honored:** no changes to focus/input *behaviour*. The one insert-path change is a **read-only foreground comparison** that aborts earlier — it never moves, claims, or yields focus.

---

## Summary

| | Count |
|---|---|
| P0 rows verified this session | **6** |
| 🐞 → ✅ fixed | **3** (1.7, 3.8, 3.14) |
| Verified by inspection/enforcement | **3** (13.2, 12.6, 9.7) |
| MANUAL TEST REQUIRED | **5** (9.2, 9.3, 9.5, 9.6 + 4.9 decision) |
| Regressions introduced | **0** |

**Baseline vs after:**

| Metric | Baseline | After | Delta |
|---|---|---|---|
| Tests failing | 126 | **124** | −2 ✅ |
| Tests passing | 3094 | **3102** | +8 ✅ |
| Failing files | 32 | **31** | −1 ✅ |
| tsc errors | 221 | **221** | 0 ✅ |

The 124 remaining failures are all pre-existing, in NLU / planner / shell / retriever suites — untouched by this work.

---

## Rows fixed

### 🐞→✅ Row 1.7 — Boot window pop *(this is your "my window goes off" bug)*

**Cause:** the dev branch in `main/index.ts` called `showMainWindow({ userInitiated: true })`, which runs `setAlwaysOnTop → show → focus → moveTop` — a hard foreground grab on **every** dev launch. It stole focus from whatever you were in, and made the next hotkey pin *Ripple's own window* instead of your app.

**Fix:** that branch now calls `mainWin.showInactive()` — window still appears, never takes foreground. Login and tray/activate paths still activate, intentionally.

**Verified 3×, full process kill each time:**
```
RUN1 FOCUS_KEPT=True window_open_lines=0 fg='(61) WhatsApp - Google Chrome'
RUN2 FOCUS_KEPT=True window_open_lines=0 fg='(61) WhatsApp - Google Chrome'
RUN3 FOCUS_KEPT=True window_open_lines=0 fg='(61) WhatsApp - Google Chrome'
```
`main window open` never appears — the force-focus path no longer runs.

### 🐞→✅ Row 3.8 — Text leaking into the wrong app

**Cause:** in the chunked `native_text` path the foreground check ran only *between* chunks (`if (i < chunks.length - 1)`), so chunks 1–2 were always sent unverified. Live evidence: `native checkpoint chunk 3/5 failed; sentChars=111/250` — **111 characters landed in an Instagram message box.**

**Fix:** the check now runs at the **start of every chunk, including the first**. Read-only `getForegroundWindow` comparison; aborts sooner, changes no focus behaviour.

**New tests** (`chunkLeakGuard.spec.ts`):
- wrong foreground from the start → `insert_aborted:foreground_changed_mid_send:sentChars=0` and **`runInputSequenceNative` never called**
- focus changes mid-send → stops at the boundary, does not push remaining chunks
- foreground correct → all chunks sent (no false abort)

### 🐞→✅ Row 3.14 — Clipboard destroyed

**Cause:** `clipboard_paste` overwrote the clipboard and never restored it.

**Fix:** snapshot before writing; restore **700 ms after the paste lands** — never before, so it cannot race the target app reading it.

**Verified live in the smoke test:**
```
STEP3_clipboard_now='SENTINEL_USER_CLIPBOARD'
[ripple-insert] clipboard_restored len=23
```
Plus `clipboardRestore.spec.ts` asserting paste-then-restore ordering (the dictated text *is* on the clipboard at Ctrl+V time, the user's content is back afterwards).

---

## Rows verified without code change

| Row | Finding |
|---|---|
| **13.2** Secrets | ✅ Clean. `.env` untracked + gitignored, only `.env.example` committed. The single regex hit is a **fake** key inside a test asserting redaction works (`phase-p85-evidence-reports.spec.ts:55`). No real credentials in shipped source |
| **12.6** Packaged ≠ dev | ✅ The window-pop branch is gated on `ELECTRON_RENDERER_URL`, which electron-vite sets **only** in dev; production uses `loadFile`. Doubly safe now that even the dev path no longer steals focus |
| **9.7** Meeting consent | ✅ Enforced in the recorder itself, not just UI: `startMeetingRecording()` throws `meeting_consent_required` if consent is absent — cannot be bypassed via another call path |

Also recovered: `phase-p85-p73-verify-value.spec.ts` (2 tests) — its `focusContext` mock was missing exports that `observe.ts` imports, so both tests threw instead of asserting. **Test-only fix, no production change.**

---

## MANUAL TEST REQUIRED

Automation cannot reach these — they need real audio, real people, or a real installer environment.

| Row | Why | What you need to do |
|---|---|---|
| **9.2** Other audio during meeting | Needs real system audio + a real call | Start a meeting, play YouTube, confirm the transcript doesn't ingest it |
| **9.3** Prompt text leaking into transcript | Needs a real transcription round | Run 3+ meetings, grep output for phrases like "Preserve speaker content faithfully" |
| **9.5** Summary of garbled audio | Needs deliberately poor audio | Mumble/noise for 2 min, confirm it flags "unclear" instead of inventing a narrative |
| **9.6** Concrete details preserved | Needs a real conversation | Say specific amounts/names, confirm they survive into the summary and aren't flattened |
| **4.9** Audio loopback at boot | Judgement call, see below | — |

### Row 4.9 — deliberately NOT changed

`initAudioLoopback()` runs at every boot and is my prime suspect for the renderer + Audio Service crash (Row 4.2). **I did not make it lazy**, because the library requires `initMain()` before `app.ready` to register the display-media handler — deferring it would likely break Meeting Notetaker, which is exactly the "don't break my other logic" line you drew.

Mitigation already in place: renderer auto-recovery (Row 4.2) reloads the window if that crash happens, so the app no longer disappears. Changing the loopback init should be its own scoped task with Meeting regression tests.

---

## Files changed

| File | Change | Risk |
|---|---|---|
| `electron/main/index.ts` | Dev-boot branch: `showInactive()` instead of force-focus | Low — one branch, dev-only |
| `electron/automation/input/inputStrategy.ts` | Pre-chunk foreground check; clipboard snapshot/restore | Low — read-only check + additive restore after paste |
| `electron/automation/input/__tests__/chunkLeakGuard.spec.ts` | **new** — 3 tests | Test-only |
| `electron/automation/input/__tests__/clipboardRestore.spec.ts` | **new** — 3 tests | Test-only |
| `electron/agent/__tests__/phase-p85-p73-verify-value.spec.ts` | Completed an incomplete mock | Test-only |
| `cursor/PRODUCTION-EDGE-CASES.md` | Status updated in place | Docs |

**Not touched:** `electron/focus/**`, press path, `hotkey_pin`, `main_suppress`, `press_sequence`, `restoreFocusContext`, insert strategy ordering, screen-bias logic.

---

## Final smoke test (after all fixes, fresh process kill)

```
STEP1_killed electron=0 sidecar=0
STEP1_boot=READY
STEP2_dictate=Smoke test sentence for production readiness.
STEP3_clipboard_now='SENTINEL_USER_CLIPBOARD'
STEP4_new_crash_logs=0
STEP5_electron_alive=5
[ripple-insert] clipboard_check len=45 hash8=3e73ba2f
[ripple-insert] paste_send result=ok
[ripple-insert] clipboard_restored len=23
[ripple-insert] strategy=clipboard_paste status=ok len=45
```
All steps pass. No `main window open`. Zero new crash logs.

---

## Still open before you ship

1. The 4 **Meeting Notetaker** rows above — these are correctness/consent issues around recording other people, the highest-consequence untested area.
2. **Row 3.17** — intermittent Windows autocorrect corrupting SendInput in Notepad (`"focus"` → `"cccus"`). Seen once, not reproduced since.
3. **Row 7.1** — English still mis-detected as Sindhi/Urdu/Nynorsk upstream; guarded downstream but the root cause is unfixed.
4. **Row 5.5** — the `Mehreen → Mehrin` fix is unit-verified; worth one live confirmation in that chat.

**P1/P2 rows not attempted this session — run the loop again scoped to P1 once these P0 items are stable in production.**
