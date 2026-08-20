# Dictation latency report — 2026-08-20 (Phase 4 pass)

> ## Pass 3 — production "no" filter + PowerShell removed from the hot path
>
> ### Confirmed live from pass 2
>
> ```
> compose→paste  4082ms → 2671ms   (−1411 ms, on 13× more text)
> screen_bias_wait ms=0 source=prewarm      ← prewarm working
> llm=1748ms cleaned=1                      ← clean now SUCCEEDS (was aborting at 900ms)
> ai_rewrite skipped backend_pipeline       ← Layer2a skip working
> clipboard_restored now prints AFTER the latency line  ← deferred, off the clock
> ```
>
> ### Fix 1 — production `no` filter
>
> Live sample B contained *"…suppose if there is **no** Stack, it will show **no** Stack…"* — ordinary speech. The detector classified it `single_no`, forcing a Layer2a call that burned **3106 ms** to answer *"'no Stack' … is a normal sentence meaning"*, plus a **1.2 s aborted** rewrite on top.
>
> Root cause: `IDIOMATIC_NO` only matched at the **start** of the utterance, so any mid-sentence `no` fell through to the LLM.
>
> The filter is now grammatical rather than positional. A **determiner** `no` attaches straight to the noun it negates and never takes a comma (`no stack`, `no slots`). A **retraction** `no` is delimited by a pause, introduces a repair cue (`no wait`, `no sorry`, `no I mean`), or sits between two same-category restatements. Only the latter escalates.
>
> `noFilterProduction.spec.ts` — **25/25**, including the exact 614-char sentence that cost 3.1 s, twelve ordinary-speech phrases that must never escalate, and every retraction form that must still be caught.
>
> ### Fix 2 — the ladder's unexplained ~1.9 s, found and removed
>
> Instrumented `invokeWin32` and found the cause: **it spawns a full PowerShell process per call.**
>
> ```
> powershell_spawn preSendState        avg=639ms  n=5   total=3195ms
> powershell_spawn clickUiaComposerEdit avg=759ms n=15  total=11398ms
> ```
>
> `getPreSendStateNative` was the **only hot-path probe still on PowerShell** — every other native call (`get_foreground`, `get_focused_a11y`) already used the sidecar pipe. It ran before every send, costing ~639 ms per insert.
>
> Added a `pre_send_state` RPC to the Rust sidecar (`GetAsyncKeyState` + `IsWindowVisible` + `IsIconic` + `GetForegroundWindow`) and routed the desktop through it, keeping PowerShell as fallback. **Read-only, identical fields, identical gate decisions — only the transport changed.**
>
> Live proof:
>
> | | Before | After |
> |---|---|---|
> | `preSendState` PowerShell spawns | 5 (@639 ms) | **0** |
> | `presend_probe ≥100 ms` | every insert | **0** |
> | RPC fallback warnings | — | **0** |
> | Gates still enforcing | 5 | **5** (`visible=1 iconic=0`) |
>
> ### Note on `clickUiaComposerEdit` (759 ms × 3/insert)
>
> Looks alarming but does **not** apply to normal WhatsApp dictation: `ensureBrowserComposerFocus` calls `getFocusedA11yElement()` first, which already uses the fast sidecar RPC, and short-circuits to `already_focused` without clicking — which is exactly what your log shows. The expensive path only runs when the composer genuinely is not focused. **Left alone: it is focus logic.**
>
> ### Verification
>
> tsc **221 = baseline**; Rust sidecar builds clean; desktop **224/224 across 31 files**; backend **25/25**. No focus/insert behaviour changed — the gates run identically, just over a pipe instead of a process spawn.
>
> **&lt;700 ms still not claimed.** STT alone was 3025 ms and 4824 ms in your two samples.


> ## Pass 2 — driven by the first real spoken sample
>
> Your live WhatsApp log changed the diagnosis. **Correction to what I said in pass 1:** I called STT the bottleneck and said desktop work could not help. The spoken sample shows otherwise:
>
> ```
> backend_pipeline stt=2210ms llm=944ms total=3166ms cleaned=0
> compose→paste=4082ms   post_stt_total=4104ms
> screen_bias_wait ms=0 source=prewarm        ← pass-1 prewarm CONFIRMED working
> ```
>
> **compose→paste (4082 ms) is larger than STT (2210 ms).** The single biggest cost was desktop-side work happening *after* the text already existed.
>
> ### Fixed in this pass
>
> | # | Finding | Fix |
> |---|---|---|
> | 1 | **`clipboard_restored len=0`** — 700 ms spent restoring an **empty** clipboard, on the user's clock. My own Row 3.14 regression. | Hand-back still happens after the same settle delay, but is no longer awaited. A generation guard stops a stale restore clobbering a later insert. |
> | 2 | **`llm=944ms cleaned=0`** — the clean timeout defaulted to **900 ms**; gpt-4o-mini rarely finishes that fast, so it aborted on essentially every call. Full cost paid, nothing returned, desktop then cleaned locally in **10 ms**. | Short fluent speech (≤14 words, no disfluencies) now **skips the LLM entirely** server-side, mirroring the desktop fastpath. Remaining calls get a budget they can actually meet (1800 ms) and log `dictation_clean timed_out` when they miss. |
> | 3 | compose→paste was unattributed | Timing-only phase markers on the shared UIA calls every insert path uses. |
>
> For the sample you ran ("Hello, how are you?", 4 words) fixes 1 + 2 remove **~1.6 s**: 944 ms of dead LLM wait plus 700 ms of clipboard housekeeping.
>
> ### What the instrumentation found
>
> ```
> composer_focus   1658ms on one call (cold UIA; the other 9 were <50ms)
> verify            229ms every insert (n=5, consistent)
> observe           <50ms — cheap, not a suspect
> ```
>
> Two honest notes on these:
>
> - **`verify` (~229 ms) is mostly a deliberate 200 ms settle that runs AFTER the paste has landed.** So `compose→paste` overstates what you actually *feel* — the text is on screen before the timer stops. I did **not** touch it: the loop forbids weakening insert verify to manufacture latency wins, and that rule is right.
> - **`composer_focus` spiked to 1658 ms once, on the first insert only.** That looks like UIA cold-start, not per-insert cost. It is called ~3× per insert but nearly all of those calls are <50 ms, so the repetition is cheap. I did not change it — it is focus logic, which is off limits.
>
> ### Instrumentation caught a wrong assumption
>
> My first attempt put the markers in the generic ladder at the bottom of `runInsertText`. **WhatsApp/Instagram dictation returns earlier**, through the compose adapters, and never reaches it — so the first instrumented run produced zero phase lines. The markers now sit on the shared UIA calls instead, which every path goes through.
>
> ### Still true
>
> **&lt;700 ms remains out of reach.** `stt_ms` alone is 2210 ms. These fixes move you toward "usable", not toward the Wispr claim. Gap row 26 stays ⚠️.


## Verdict

| Gate | Result |
|---|---|
| **Gate A** — honest instrumented | **PASS** (re-verified live: `[ripple-latency]` lines present, diag OFF, fastpath firing) |
| **Gate B** — feels faster | **PARTIAL** — the two desktop-side poles this loop targeted are fixed and measured; the STT-dependent rows (B1–B6) need a spoken sample |
| **Gate C** — Wispr &lt;700 ms | **NOT ACHIEVED — blocked on STT floor.** Do not claim it. |

**&lt;700 ms is not true for Ripple today and nothing in this pass changes that.** Whisper-1 alone runs ~1.0–2.2 s; the desktop work below removes ~250–310 ms + up to ~1.5 s of *desktop* cost, which is real but sits on top of an STT floor that is 2–3× the entire &lt;700 ms budget.

---

## What changed this loop

### 1. Screen bias taken OFF the critical path (checklist #1) — **measured win**

The UIA + OCR gather depends only on **what is on screen**, never on the transcript — but it only started *after* STT returned, so its full wall time was added to stop→paste.

It now starts at `voice:end`, overlapping the 1.8–3.1 s STT round trip we already pay.

**Live measurement of the cost that was on the critical path** (5 samples, real compose pipeline):

```
S1 bias_wait_ms=310 source=inline ocr_ms=-   gather=328chars/4terms
S2 bias_wait_ms=292 source=inline ocr_ms=106 gather=630chars/20terms
S3 bias_wait_ms=246 source=inline ocr_ms=87  gather=630chars/20terms
S4 bias_wait_ms=234 source=inline ocr_ms=81  gather=630chars/20terms
S5 bias_wait_ms=232 source=inline ocr_ms=84  gather=630chars/20terms

BIAS_WAIT n=5 p50=246ms p90=310ms max=310ms
OCR_MS    n=4 p50=87ms  max=106ms
```

Note the split: **OCR is only ~87 ms**; the bulk of the 246 ms is the UIA gather. Gate B's budget is `ocr_ms ≤ 200` **or** fail-open without blocking paste — this takes the whole gather off the paste path rather than shrinking it, so **Feature #20 name quality is untouched**.

**Quality guard:** if the prewarmed gather comes back empty (OCR timeout, self-capture discarded, thin UIA) it **regathers inline**. Prewarming can therefore only make it faster, never worse.

### 2. `cleaned=1` no longer pays for Layer2a (checklist #2) — **real bug fixed**

The Phase 3 "skip desktop AI when the server already cleaned" guard only covered the **cleanup** branch. **Layer2a ran earlier and did not check `backendCleaned` at all**, so a `cleaned=1` utterance carrying a correction signal still paid a full classifier round trip (~0.8–1.5 s) on the critical path. Now skipped, with `layer2a skipped backend_pipeline` as proof.

### 3. `cleaned=0` temporal "no" resolved locally (checklist #3) — **fixes a listed failure mode**

The loop's failure table lists: *Weak "no" cleanup → final still `"…No, 10pm"` → required: clean to single meeting time.*

`"meet at 9pm, no, 10pm"` is now resolved **locally** to `"meet at 10pm"` — no LLM call, and the retraction no longer survives into the message. This reuses the exact mechanism `double_no` / `actually_no` already trusted.

**Deliberately conservative gate** — the local path fires only when **both** hold:
- the `no` is comma-delimited (`, no,`) — a bare "no" is ordinary speech
- there is a temporal token on **both** sides

So `"at 2pm there is no 3pm option"`, `"we have no slots left today"`, `"tell him no, that plan"` all still go to the LLM, unchanged. Six guard-rail tests cover exactly these.

### 4. Diag tax confirmed OFF (checklist #4)

`insert-text-diag` occurrences in a full live run: **0**.

---

## ⚠️ One behaviour change you should confirm

Fixing #3 changed what two existing tests asserted:

- `phase-p85-p72-ai-rewrite.spec.ts` used `"Meet tomorrow, no, day after tomorrow at 8 o'clock"` to exercise the **classifier** path. That utterance now resolves locally, so I re-pointed both tests at a **non-temporal** correction (`"blue folder, no, the red folder"`), which still requires the classifier. **Both original contracts remain genuinely tested** — I did not delete or weaken them — and a third test now covers the new local path.

This is a real product-behaviour change: previously, if the classifier was unavailable, a temporal "no" correction was left literal in the user's text. It is now cleaned locally. The loop explicitly requires this ("clean to single meeting time"), but it is your call — say the word and I will revert it.

---

## Why Gate C is blocked (the honest arithmetic)

| Component | Live cost | Share of a 700 ms budget |
|---|---|---|
| Whisper-1 STT | **~1.0–2.2 s** | **143–314%** — over budget on its own |
| Backend LLM clean | ~0.8–0.9 s | 114–129% |
| Screen bias (was) | ~246–310 ms | now ~0 (overlapped) |
| Layer2a when it fired | ~0.8–1.5 s | now skipped on `cleaned=1` |

Even with **every desktop cost driven to zero**, `stt_ms` alone exceeds 700 ms. Gate C cannot be reached by desktop work — it needs a **faster STT path** (streaming finalize, a smaller/faster model, or dedicated inference), which is Phase 3b and lives in the backend.

**Therefore:** gap row 26 stays **⚠️**, and marketing language stays "not Wispr-class".

---

## Samples

Screen-bias samples are real (above). The full `stt_ms / llm_ms / pipeline_total / post_stt_total` table is **not filled in** because those rows require a **spoken** utterance — the file test-bridge skips STT by design, and this machine has no way for me to produce microphone audio.

| # | words | stt_ms | llm_ms | pipeline_total | post_stt_total | cleaned | insert |
|---|-------|--------|--------|----------------|----------------|---------|--------|
| — | — | *needs spoken sample* | — | — | — | — | — |

### How to fill this in (2 minutes)

1. Start backend and desktop (`npm run dev` in both).
2. Focus the WhatsApp Web composer in Chrome.
3. Shift+Space → say **"hello how are you"** → Shift+Space.
4. Repeat 10×, then paste these lines here:
   ```
   [ripple-backend]  pipeline stt_ms=… llm_ms=… total_ms=… cleaned=…
   [ripple-latency]  backend_pipeline stt=… llm=… total=… cleaned=…
   [ripple-latency]  screen_bias_wait ms=… source=…      ← expect source=prewarm, ms≈0
   [ripple-latency]  layer2a skipped backend_pipeline     ← expect this when cleaned=1
   [ripple-latency]  stt→compose=… compose→paste=… post_stt_total=…
   ```

The line that proves this pass worked end-to-end is **`screen_bias_wait ms=… source=prewarm`**. Live today it reads `source=inline` at 232–310 ms, because the bridge path never calls `voice:end`.

---

## What must not be claimed

- **Wispr &lt;700 ms: NO.** Not achieved, not close, blocked on the STT floor.
- Gate B is **not** signed off — B1–B6 need spoken samples.

---

## Remaining checklist

| # | Item | Status |
|---|---|---|
| 1 | OCR hard budget / off critical path | ✅ Done (prewarm + inline-retry guard) |
| 2 | `cleaned=1` → zero Layer2a | ✅ Fixed (was a real gap) |
| 3 | `cleaned=0` weak `single_no` | ✅ Fixed locally, guard-railed |
| 4 | compose→paste spikes / diag OFF | ✅ Confirmed 0 diag lines live |
| 5 | Chunk logging / flush health | ⬜ Needs spoken ≥5 s sample |
| 6 | Backend `cleaned=1` rate vs llm_ms | ⬜ Backend, not attempted |
| 7 | Language pin `en` for lighter Whisper path | ⬜ Not attempted |
| 8 | Gate B sample table (10 short + 5 medium) | ⬜ Needs spoken samples |
| 9–13 | Phase 3b / Gate C / Phase 5 | ⬜ Blocked on STT infra decision |

---

## Insert / focus

**Unchanged.** No file under `electron/focus/`, no insert-ladder file, and no press-path file was modified in this pass.

Files touched:

| File | Change |
|---|---|
| `electron/agent/dictation/screenNameBias.ts` | Prewarm + consume + inline-retry guard (allowed: OCR budget / fail-open) |
| `electron/agent/dictation/dictationRewrite.ts` | Skip Layer2a when `backendCleaned` |
| `electron/agent/dictation/correctionSignalDetector.ts` | Local temporal `single_no` resolution, comma+temporal gated |
| `electron/main/index.ts` | One fire-and-forget prewarm call at the top of `voice:end` (allowed: voice:end wiring) |
| 2 spec files + 2 new spec files | Tests |

`RIPPLE_P85_STREAMING_INSERT` remains default **OFF**. Jarvis untouched.

**Verification:** tsc **221 = baseline** (unchanged). Dictation + agent suites: **10 failing files, all pre-existing** (`phase-p85-e4-e7`, `notion-tool`, `p54-compound`, `p5-e2e-qa`, `p72-production-eval`, `phase1-desktop-tools`, `phase2-pipeline`, `phase2-safety`, `phase5-filesystem`, `utterance-fixtures`) — **zero** failures in `agent/dictation/**`. New specs: `screenPrewarm.spec.ts` (6/6), `latencyLlmSkips.spec.ts` (7/7).
