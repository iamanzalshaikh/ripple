# Dictation latency — implementation plan (Wispr-class stop→paste)

**Date:** 2026-08-20 (status refreshed same evening after live WhatsApp/Cursor samples)  
**Status (honest):** Engineering Phases **0–3 code complete**. Wispr **&lt;700 ms p99 is NOT achieved** and must **not** be claimed.  
**Live post–Phase 3 (this machine):** backend `stt+llm` often **~1.8–3.1 s**; `post_stt_total` often **~5–8 s**. Insert/focus **unchanged**.  
**Goal:** Cut **stop speaking → text in field** toward Wispr Flow’s published **&lt;700 ms p99** ASR+LLM feel (real-world Wispr often ~1.0–1.5 s).  
**Canonical Wispr plan:** [WISPR-FLOW-FINAL-PLAN.md](./WISPR-FLOW-FINAL-PLAN.md)  
**Gap checklist:** [WISPR-FLOW-GAP-ANALYSIS.md](./WISPR-FLOW-GAP-ANALYSIS.md) row **26**  
**Agent loop (keep iterating):** [../cursor/dictation-latency-loop.md](../cursor/dictation-latency-loop.md)  

**Do not** treat “add Web Workers” as the main fix. Workers help UI jank; paste latency is **STT + LLM + sequential post-stop work**.

---

## Completion scorecard (2026-08-20 evening)

| Phase | Name | Code? | Live proven? | Wispr &lt;700 ms? |
|-------|------|-------|--------------|------------------|
| **0** | Measure `[ripple-latency]` / Whisper ms | ✅ Done | ✅ Yes | — |
| **1** | Mid-speech **upload-only** flush (2.5s); insert stream OFF | ✅ Done | ✅ Chunks seen | No (STT still full-blob after stop) |
| **2** | Local cleanup fastpath + AI **1.2s** fail-open | ✅ Done | ✅ Abort / fastpath logs | No |
| **3** | Server STT + `dictation_clean` on `voice:end`; skip 2nd rewrite | ✅ Done (v1) | ✅ `backend_pipeline` + `cleaned=0/1` | **No** — server alone ~1.8–3.1 s |
| **4** | Perception (UI states, OCR cap) | 🟡 Partial | ✅ Bias cost measured + moved off critical path | No — STT floor dominates |
| **5** | Streaming insert (7.8) | ❌ Paused | — | — |

**Phase 4 progress (2026-08-20, later pass) — see [../cursor/DICTATION-LATENCY-REPORT.md](../cursor/DICTATION-LATENCY-REPORT.md):**

- **Screen bias off the critical path.** The UIA+OCR gather depends only on the screen, not the transcript, so it now starts at `voice:end` and overlaps the STT round trip. Live cost it used to add after STT: **p50 246 ms / p90 310 ms** (OCR itself only ~87 ms — the bulk is UIA). Fails safe: an empty prewarm regathers inline, so Feature #20 quality cannot degrade.
- **`cleaned=1` Layer2a gap fixed.** The Phase 3 skip only guarded the cleanup branch; Layer2a ran earlier without checking `backendCleaned`, so a `cleaned=1` utterance with a correction signal still paid ~0.8–1.5 s. Now `layer2a skipped backend_pipeline`.
- **`cleaned=0` temporal "no" resolved locally.** `"meet at 9pm, no, 10pm"` → `"meet at 10pm"` with no LLM, gated to comma-delimited `no` **with a temporal on both sides** so ordinary speech ("there is no 3pm option") still goes to the LLM.
- **Diag tax confirmed OFF** — 0 `insert-text-diag` lines in a full live run.
- **UI "cleaning…" states: still not started.**

Still **not** &lt;700 ms: `stt_ms` alone (~1.0–2.2 s) exceeds the entire budget, so Gate C remains blocked on a faster STT path (Phase 3b, backend).

**Also fixed while measuring:** unpackaged `insert-text-diag` default **OFF** (was adding ~3–5 s to `compose→paste`).

**Still open for “feels fast” (not &lt;700 ms yet):** OCR/screen-bias wall time (~180–480 ms), Layer2a correction LLM when `cleaned=0` (~1.5 s), residual `compose→paste` (~3–5 s on some samples), and **Whisper-1 wall clock** (~1–2+ s).

---

## 1. Honest baseline (Ripple tonight)

| | Wispr Flow (claim / felt) | Ripple tonight (after Phase 0–3) |
|--|---------------------------|----------------------------------|
| ASR + LLM cleanup | Yes — tuned pipeline, claim **&lt;700 ms p99** | Yes — Whisper + server/desktop `dictation_clean` |
| Sequencing | Overlapped / engineered cloud path | Upload overlaps mid-speech; **STT+clean still after stop** |
| Mid-speech work | Pipeline already advancing | Dictation uploads chunks; **no** mid-field typing (7.8 off) |
| Stop→paste (live) | Claim &lt;700 ms; reviews often ~1–1.5 s | Backend pipeline **~1.8–3.1 s**; E2E post-STT often **~5–8 s** |

**We already do ASR + LLM.** We do **not** yet do Wispr’s **&lt;700 ms coordinated** version.

---

## 2. Success metrics (must measure before claiming)

| Metric | Meaning | Target (phase) | Live tonight |
|--------|---------|----------------|--------------|
| `t_stop` | Hotkey release / speech end | — | Armed |
| `t_stt_done` | Final transcript available | Phase 3: p90 &lt; 600 ms after stop | **Miss** — Whisper often 1–2+ s |
| `t_llm_done` | Cleanup finished (or skipped) | Phase 2–3: p90 &lt; 400 ms | **Miss** — clean ~0.8–0.9 s when it runs |
| `t_paste_done` | Insert strategy ok | Phase 1–4: **p90 stop→paste &lt; 1.2 s**; stretch **&lt; 700 ms** | **Miss** |
| `ocr_ms` / bias | Screen bias wall time | Never block paste &gt; 200 ms | Often **180–480 ms** (over budget) |

Ship gate for “Wispr-feel latency”: **p90 stop→paste ≤ 1.2 s** on short EN utterances (≤15 words), good network, Cleanup High.  
Stretch / marketing-safe Wispr claim: **p99 ≤ 700 ms** only after a **faster STT stack** proves it — do **not** claim after Phase 3 v1.

---

## 3. Phases (implementation order)

### Phase 0 — Measure — **DONE 2026-08-20**

Desktop `[ripple-latency]` + backend Whisper ms. Live samples show **STT + LLM dominate**.

### Phase 1 — Mid-speech upload-only — **DONE 2026-08-20**

Flush every **2500 ms**; insert stream **OFF**. Upload overlap ≠ Wispr STT overlap (Whisper still full audio after stop).

### Phase 2 — Smarter cleanup — **DONE 2026-08-20**

Local fastpath + AI **1.2 s** fail-open. When Phase 3 `cleaned=1`, desktop skips rewrite.

### Phase 3 — Backend STT + LLM (v1) — **DONE 2026-08-20** — **not &lt;700 ms**

`voice:end` + server `dictation_clean`; timings logged. Live backend alone **~1.8–3.1 s**. Next = faster STT (3b), not paste-ladder changes.

### Phase 4 — Perception + residual — **NOT STARTED**

UI “cleaning…” states; hard-cap OCR so it never blocks paste &gt; 200 ms.

### Phase 5 — Streaming insert (7.8) — **PAUSED**

Default OFF until streaming STT is proven.

---

## 4. What we will not do

| Idea | Why not (as primary) |
|------|----------------------|
| Web Workers as the latency project | Doesn’t speed Whisper/OpenAI |
| Claiming &lt;700 ms after Phase 0–3 v1 | Marketing lie vs Wispr — live numbers disprove it |
| Re-enabling 7.8 early | Known editor damage |
| Touching insert/focus ladder for “speed” | Regression risk; paste already fast enough vs STT |

---

## 5. Doc links

- Gap row **26** — Stop→paste latency (Wispr &lt;700 ms)  
- FINAL plan Phase **7.8b** — Dictation latency program (this file)  
