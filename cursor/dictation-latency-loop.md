# LOOP — Dictation latency (Wispr &lt;700 ms program)

You are working in a **loop**. Do not stop after one pass — keep iterating until every VERIFY item for the **current milestone** passes or you hit the iteration limit. Unit tests alone are NOT enough. **Live WhatsApp (or Cursor) dictation with `[ripple-latency]` / `backend_pipeline` logs is required.** Do not ask the user mid-loop — assume, note, continue.

**Canonical plan:** `docs/DICTATION-LATENCY-PLAN.md`  
**Gap row:** `docs/WISPR-FLOW-GAP-ANALYSIS.md` #26  
**FINAL plan:** `docs/WISPR-FLOW-FINAL-PLAN.md` item **7.8b**  
**Final report path:** `ripple-desktop/cursor/DICTATION-LATENCY-REPORT.md`

---

## GOAL

Cut **stop speaking → text in field** toward Wispr Flow’s published **&lt;700 ms p99** ASR+LLM feel.

**Honest product truth (do not lie in docs or to user):**
- Phases **0–3 code are already landed** (measure, upload-only flush, cleanup budgets, server STT+clean).
- Live tonight: backend `stt+llm` often **~1.8–3.1 s**; `post_stt_total` often **~5–8 s**.
- **&lt;700 ms is NOT achieved.** Do **not** mark gap row 26 ✅ until measured.

**This loop’s job:** keep shrinking the poles that logs already proved, without touching insert/focus, until ship gates below pass — or document why STT infra blocks &lt;700 ms.

---

## WHERE WE ALREADY ARE (do not re-do unless regression)

| Phase | Status | Proof signal |
|-------|--------|--------------|
| 0 Measure | ✅ Done | `[ripple-latency]`, Whisper `latency ms=` |
| 1 Upload overlap | ✅ Done | `voice:chunk` mid-speech; `uploadOverlap=ON/2500ms`; `insertStream=OFF` |
| 2 Cleanup budgets | ✅ Done | `ai_rewrite skipped fastpath` / abort @1.2s / local cleanup |
| 3 Server pipeline v1 | ✅ Done | `backend_pipeline stt=… llm=… cleaned=0\|1`; `ai_rewrite skipped backend_pipeline` |
| Insert-text-diag tax | ✅ Fixed | Default OFF unless `RIPPLE_INSERT_TEXT_DIAG=1` |
| 4 Perception / OCR cap | ❌ Open | — |
| 5 Streaming insert 7.8 | ❌ Paused | Must stay OFF |
| Wispr &lt;700 ms claim | ❌ Not met | — |

---

## SUCCESS GATES (milestones — unlock in order)

### Gate A — “Honest instrumented” (already mostly green; re-verify each warm session)
- [ ] Every dictation shows `[ripple-latency] backend_pipeline` OR desktop compose/paste totals
- [ ] Mid-speech: at least one `voice:chunk` on utterances ≥3 s
- [ ] When `cleaned=1`: log has `ai_rewrite skipped backend_pipeline` (no second `/voice/rewrite` abort)
- [ ] Insert still `clipboard_paste` / `native_text` **ok** — WhatsApp + Cursor

### Gate B — “Feels faster” (ship gate for beta feel — NOT Wispr claim)
**Primary success case (BLOCKING):**
- WhatsApp Web (Chrome) composer focused.
- Dictate short EN: **"hello how are you"** (≤6 words), Cleanup High, good network.
- **Expected:**
  - `backend_pipeline` total **p90 ≤ 1.5 s** across 10 samples (or document STT floor)
  - `post_stt_total` **p90 ≤ 2.0 s**
  - `ocr_ms` **≤ 200** or bias fail-open without blocking paste
  - No `compose→paste` ≥ 3000 ms (diag must stay off)
  - Paste lands in WhatsApp field; no progressive mid-typing

**Secondary (all required before Gate B FINAL):**

| # | Scenario | Expected |
|---|----------|----------|
| B1 | Short “hello how are you” ×10 | Record p50/p90 `backend_pipeline total` + `post_stt_total` |
| B2 | Medium ~20 words ×5 | `stop→stt` not worse than Phase 0; chunks uploaded |
| B3 | `cleaned=1` path | No desktop `ai_rewrite ok` / no abort wait |
| B4 | `cleaned=0` path | Fail-open local; **no** Layer2a burn ≥1.5 s on trivial “No, 10pm” mess — or clean to single intent |
| B5 | Cursor native_text | Insert ok; latency logged |
| B6 | Warm session | 5 WhatsApp + 2 Cursor — no crash, pin intact |

### Gate C — “Wispr-claim safe” (ONLY after Gate B green + faster STT)
- [ ] **p90 stop→paste ≤ 700 ms** on short EN (≤15 words), Cleanup High, good network — **measured**, not hoped
- [ ] Gap row 26 may move toward ✅ **only** with numbers in DICTATION-LATENCY-REPORT.md
- [ ] Until then gap stays **⚠️** and marketing language stays “not Wispr-class”

**If Whisper-1 alone stays ≥1000 ms:** Gate C is **blocked by infra**. Loop must:
1. Prove the floor with 20 samples
2. Propose Phase **3b** (faster STT / streaming finalize / dedicated clean model)
3. Update docs: “Phase 0–3 done; &lt;700 ms blocked on STT floor = X ms”
4. Still finish Gate B (feel) before stopping

---

## DO NOT REGRESS OR MODIFY

- Insert ladder (`clipboard_paste`, `native_text`, `modifiers_before_send`, `target_state`, `composer_focus`)
- Focus / pin (`hotkey_pin`, `press_sequence`, `main_suppress`, `restoreFocusContext`, focus drift)
- Anything under `electron/focus/` or insert orchestration “for speed”
- Enabling `RIPPLE_P85_STREAMING_INSERT` / progressive typing into WhatsApp
- Meeting Notetaker summarize path on dictation hot path
- Jarvis — stay off
- Do not weaken insert verify to fake latency wins
- Do not claim &lt;700 ms in gap analysis without Gate C numbers

**Allowed touch surfaces (latency loop):**
- `ripple-desktop/src/pages/Overlay.tsx` — upload overlap, `endVoice` flags, latency logs only
- `ripple-desktop/src/hooks/useVoiceCapture.ts` — continuous flush correctness
- `ripple-desktop/electron/agent/dictation/dictationRewrite.ts`
- `ripple-desktop/electron/agent/dictation/aiRewriteDictation.ts`
- `ripple-desktop/electron/agent/dictation/localCleanup.ts`
- `ripple-desktop/electron/agent/dictation/prepareComposeText.ts` — scheduling / skip paths only
- `ripple-desktop/electron/agent/dictation/screenNameBias.ts` — **OCR budget / fail-open only** (do not reopen Feature #20 name quality in this loop unless OCR blocks Gate B)
- `ripple-desktop/electron/automation/actions/insertTextDiagnostics.ts` — keep default OFF
- `ripple-desktop/electron/socket/rippleSocket.ts`, preload, `electron/main` voice:end wiring
- `ripple-backend/src/services/voiceStreaming.service.ts`
- `ripple-backend/src/services/dictationClean.service.ts`
- `ripple-backend/src/config/socket.ts`, `config.ts`
- Docs: `DICTATION-LATENCY-PLAN.md`, gap row **26**, FINAL **7.8b**, this LOOP, `DICTATION-LATENCY-REPORT.md`

---

## VERIFY (must ALL be true for current gate — unchecked = keep looping)

### A. Unit / code
- [ ] Dictation-related vitest still green (compose / pipelineLayers at minimum)
- [ ] Typecheck: zero **new** errors in touched files
- [ ] `git diff` shows **no** insert/focus ladder changes
- [ ] Streaming insert env remains default OFF

### B. Live logs (blocking every iteration that claims a latency win)
- [ ] Restart backend + desktop after code changes
- [ ] Capture one short WhatsApp dictation
- [ ] Paste these lines into the report (or note file):
  ```
  [ripple-backend] whisper latency ms=…
  [ripple-backend] pipeline stt_ms=… llm_ms=… total_ms=… cleaned=…
  [ripple-latency] backend_pipeline stt=… llm=… total=… cleaned=…
  [ripple-latency] ai_rewrite skipped …
  [ripple-latency] stt→compose=… compose→paste=… post_stt_total=…
  [ripple-insert] strategy=… status=ok
  ```
- [ ] If `compose→paste` ≥ 3000 ms → find cause (diag, OCR, Layer2a, confirm UI) and fix **without** changing insert ladder

### C. Metrics table (Gate B / C)
- [ ] At least **10** short samples with totals recorded
- [ ] p50 / p90 computed for `backend_pipeline.total_ms` and `post_stt_total`
- [ ] Gap row 26 updated with honest numbers (⚠️ until Gate C)

### D. Docs
- [ ] `DICTATION-LATENCY-PLAN.md` scorecard matches reality
- [ ] `DICTATION-LATENCY-REPORT.md` written on FINAL (template below)

---

## IMPLEMENTATION CHECKLIST (next work — do in order)

### Still open — Gate B (do these next)

1. [ ] **OCR hard budget:** screen bias must not block paste &gt; **200 ms** (fail-open; log `ocr_ms`). Parallelize vs already-cleaned backend text when safe.
2. [ ] **When `cleaned=1`:** ensure **zero** Layer2a / desktop AI cost (already intended — prove with logs).
3. [ ] **When `cleaned=0`:** avoid burning 1.5 s Layer2a on weak `single_no` that leaves `"No, 10pm"`; prefer local clean to final intent or skip LLM.
4. [ ] **Kill residual compose→paste spikes:** confirm diag OFF; no double hide_overlay / heavy waits; log sub-stages if needed (**timing only**).
5. [ ] **Chunk logging / flush health:** multiple `voice:chunk +N total=` on ≥5 s speech; `alreadyStreamed` correct on stop.
6. [ ] **Backend clean reliability:** raise `cleaned=1` rate on High cleanup without exceeding ~400–600 ms llm_ms when possible (prompt/model/timeout — fail-open).
7. [ ] **Language pin:** prefer `language=en` when picker is English to avoid sindhi/nynorsk and enable lighter Whisper `json` path.
8. [ ] Collect Gate B sample table (10 short + 5 medium) → update plan + gap.

### Gate C / Phase 3b (only after Gate B or if STT floor proven)

9. [ ] Measure Whisper floor: if p50 `stt_ms` ≥ 1000 on short audio → document **infra block**
10. [ ] Evaluate faster STT option (streaming finalize, smaller model, dedicated provider) — **backend**
11. [ ] Single RTT already exists; optimize internal overlap only if STT allows
12. [ ] Only then consider Phase 4 UI “Finishing…” perception polish
13. [ ] Phase 5 (7.8) remains **paused** unless product explicitly unlocks

### Known live failure modes (must stay fixed / watched)

| Failure | Symptom | Required behavior |
|---------|---------|-------------------|
| Second rewrite after server clean | `ai_rewrite ok` after `cleaned=1` | Skip desktop AI |
| Abort tax | `ai_rewrite error: aborted` @~1200 ms | Prefer server clean; fail-open local |
| Diag tax | `compose→paste` ~5 s + insert-text-diag walls | Diag default OFF |
| OCR tax | `ocr_ms` 400+ before paste | Cap / fail-open ≤200 ms for Gate B |
| Weak “no” cleanup | Final still `"…No, 10pm"` | Clean to single meeting time |
| Screen bias wrong word | Client vs planner | Out of scope for latency unless it adds time; do not break #20 |
| Fake &lt;700 ms | Docs claim without numbers | Forbidden |

---

## LOOP RULES

1. **One gate at a time.** Do not chase Gate C while Gate B compose→paste is still 5 s.
2. **Every iteration ends with live log proof** or an explicit “blocked on STT floor = N ms” note.
3. **Never** “fix” latency by changing focus/insert.
4. **Never** enable streaming insert in this loop.
5. If stuck 3 iterations on same number: write root cause in report, switch checklist item, continue.
6. Max **12** iterations per session unless user extends; then write report with remaining checkboxes.

---

## HOW TO RUN A LIVE SAMPLE (agent / user)

1. Backend + desktop `npm run dev` both restarted after changes.
2. WhatsApp Web focused in Chrome; click message box.
3. Shift+Space → speak short line → Shift+Space stop.
4. Copy latency lines from desktop terminal **and** backend terminal.
5. Paste into `DICTATION-LATENCY-REPORT.md` under Samples.
6. Confirm text appeared in the field (insert ok).

---

## UNATTENDED FINAL REPORT (`cursor/DICTATION-LATENCY-REPORT.md`)

When stopping (gates met or iteration limit), write:

```markdown
# Dictation latency report — YYYY-MM-DD

## Verdict
- Gate A: pass/fail
- Gate B: pass/fail (p50/p90 numbers)
- Gate C / &lt;700 ms: pass/fail / blocked (reason)

## Samples (table)
| # | words | stt_ms | llm_ms | pipeline_total | post_stt_total | cleaned | insert |
|---|-------|--------|--------|----------------|----------------|---------|--------|

## What changed this loop
- …

## What must not be claimed
- Wispr &lt;700 ms: yes/no

## Remaining checklist
- …

## Insert/focus
- Unchanged: yes/no (diff proof)
```

Also update:
- `docs/DICTATION-LATENCY-PLAN.md` scorecard
- `docs/WISPR-FLOW-GAP-ANALYSIS.md` row 26 (honest)
- `docs/WISPR-FLOW-FINAL-PLAN.md` 7.8b one-liner if status changed

---

## START HERE (next agent turn)

1. Read this LOOP + `docs/DICTATION-LATENCY-PLAN.md` scorecard.
2. Confirm Gate A still green with one live WhatsApp short dictation.
3. Attack checklist **#1 OCR hard budget** then **#3 cleaned=0 Layer2a waste** then **#4 compose→paste spikes**.
4. Collect 10 short samples → fill Gate B table.
5. Only if Gate B green: tackle Phase 3b / Gate C — or document STT floor block.

**Do not stop after docs-only updates.** Code + live proof required each loop cycle.
