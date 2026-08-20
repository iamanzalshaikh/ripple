# Wispr Flow — Ripple gap analysis (code-verified)

**Date:** 2026-08-18 (latency row + plan link updated **2026-08-20**)  
**Canonical plan:** [WISPR-FLOW-FINAL-PLAN.md](./WISPR-FLOW-FINAL-PLAN.md)  
**Latency program:** [DICTATION-LATENCY-PLAN.md](./DICTATION-LATENCY-PLAN.md)  
**Wispr inventory source:** official site/help/changelog + 2026 third-party reviews (see the user-compiled feature reference).  
**This file answers:** what Ripple actually has in *this repo*, not what the old plan claimed.

---

## Did we verify this from the code?

**Yes — every row below was checked against source files in `ripple-desktop` / `ripple-backend` on 2026-08-18.** Status is not guessed from the old plan.

| How | What it means |
|-----|----------------|
| **Code-read** | Grep + open the listed files. Feature exists or does not. |
| **Live logs (this machine)** | Also seen in `npm run dev` terminal output the same day. |
| **Not live-QA’d** | Code exists, but we did not run a full user test of that feature today. |

We did **not** re-open Wispr’s product to re-confirm their features. Wispr column stays as in the compiled reference. Ripple column is ours.

**Honest closeness (replaces 2026-07-29 “~85% Windows”):**

| Measuring | Old score (2026-07-29) | **Re-score 2026-08-18** | Why |
|-----------|------------------------|-------------------------|-----|
| Full Wispr product (all OS + enterprise) | ~42% | **~35–40%** | Windows extras landed; Mac/iOS/Android/HIPAA/billing still 0. Language/cleanup UX gaps pulled Windows down. |
| Core Windows Wispr *feel* (dictation product) | ~85% | **~55–60%** | Insert + snippets + notes + F9 are real. Cleanup levels, undo, dictation clipboard, Auto Flow, language reliability, **stop→paste latency** (Wispr claims &lt;700 ms p99; Ripple often ~1.5–3 s), meeting system-audio are not production-parity. |

Do **not** market Wispr parity.

---

## Summary checklist

Legend: ✅ have it · ⚠️ partial · ❌ missing · 🚫 not this launch

| # | Feature | Ripple | Production-ready? | Verified how | Code evidence |
|---|---|---|---|---|---|
| 1 | 4-layer pipeline (transcribe / cleanup / format / context as *separable, toggleable* stages) | ✅ Have it | **Yes** (Windows) | Code + tests | `pipelineLayers.ts` + `dictationRewrite.ts` + Language → Dictation cleanup. Default **High** = previous always-on path. Insert/focus unchanged. |
| 2 | Cleanup level None / Light / Medium / High | ✅ Have it | **Yes** (Windows) | Code + tests | Presets over the four layers in Language → Dictation cleanup. High = AI rewrite + tone. |
| 3 | Undo AI Edit (raw transcript) | ❌ | No | Code-read | Raw STT is logged (`logTranscriptStage`) and held in overlay state; **no** revert/raw-reveal button in `Overlay.tsx` / `FlowBar.tsx`. |
| 4 | Personalized Style per app category | ✅ | **Yes** (Windows) | Code-read + tests | `styleTone.ts` + `Styles.tsx`: Very Casual → Casual → Neutral → Professional → Formal per process. Legacy casual/professional/neutral still valid. Insert/focus unchanged. |
| 5 | Command Mode / Transforms | ⚠️ | **F9 yes / Ctrl+Space no** | Code-read + boot logs | Transforms: `overlay.ts` F9 → `executeTransform.ts` (unchanged insert path). Jarvis Ctrl+Space **gated off**. |
| 6 | Snippets (exact-match trigger) | ✅ | **Yes** (Windows) | Code-read + live logs | `snippets.ts` + `Snippets.tsx` + sync. Match is exact after normalize; also strips leading filler/punct (slightly *beyond* Wispr exact-match). Live: `[ripple-snippets] no match for "code settings"`. |
| 7 | Clipboard history (every dictation) | ❌ | No | Code-read | Home **History** (`History.tsx`) is **command** history (`getCommandHistory`), not a dictation clipboard. `dictationSessionWindow.ts` keeps utterances in memory for 20 min — not a browsable log. |
| 8 | Auto Flow (pause auto-submit in chat) | ❌ | No | Code-read | Dictation inserts text only (`executeDictation.ts`). No pause-detect + Enter/send for WhatsApp/Slack. |
| 9 | Dev Mode: File Tagging | ❌ | No | Code-read | No file-tag / `@filename` path. Cursor insert is generic a11y/paste. |
| 10 | Dev Mode: Variable Recognition | ❌ | No | Code-read | No camelCase / snake_case / PascalCase spoken-code handling. |
| 11 | 100+ language auto-detect / switch | ⚠️ | **No** (not Wispr-class) | Code-read + **live logs** | Picker: `languages.ts` (~15 + auto + custom ISO). Whisper auto-detect. **Live today:** `lang=welsh` / `nynorsk` on English utterances. |
| 12 | Usage stats / streaks | ❌ | No | Code-read | `Telemetry.tsx` is debug (`localStorage ripple:debug=1` in `Home.tsx`). No words/streak/apps dashboard. |
| 13 | Cross-device sync | ⚠️ | Windows account only | Code-read + live logs | `syncClient.ts` syncs dictionary / snippets / styles / notes / prefs. Live: `initial push` / `pull applied`. **No** Mac/iOS/Android clients. |
| 14 | Flow Notes | ✅ | **Yes** (Windows) | Code-read | `Notes.tsx` + notes IPC + `focusedFieldDictation` + quick capture. Syncs as `kind: "note"`. |
| 15 | Flow Bar | ⚠️ | Overlay only | Code-read + live | `FlowBar.tsx` + `Overlay.tsx` — listening bar, chips, language badge. Not a persistent Mac-style control surface. |
| 16 | Meeting Notetaker (system audio) | ⚠️ | Mic-only | Code-read + live | Meeting path exists (`meetingRecorder.ts`, overlay meeting). **Live log:** `systemAudio=OFF (DXGI unreliable)`; `includeSystemAudio: false` in `Overlay.tsx`. |
| 17 | iOS widget / Siri / Spotlight / Action Button | 🚫 | N/A | Repo scope | No iOS project. Launch checklist: do not start until Windows beta is green. |
| 18 | 20-minute sessions | ✅ | **Yes** (grouping) | Code-read | `dictationSessionWindow.ts` `SESSION_WINDOW_MS = 20 * 60 * 1000`. Groups utterances; not a hard “max recording length” UI. |
| 19 | Auto-growing dictionary from corrections | ⚠️ | Manual UI only | Code-read | Dictionary UI: `Dictionary.tsx` → `learnCorrection(..., source: "dictionary_ui")`. Voice auto-learn is Jarvis tool `memoryIntelligenceTools.ts` — **gated off** with Jarvis. |
| 20 | Context-aware spelling (nearby on-screen text) | ✅ | **Yes** (WhatsApp Web verified live) | Live WhatsApp + 25 unit | `screenNameBias.ts` — always-on (fail-open), UIA→OCR, active-chat header via repeated-name detection, whole-phrase fix, relaxed fuzzy (silent-H/double-letter) for header names, sidebar-noise suppression. Live: `fixes=Umar Mishal→Ummer Mishal`, `Humar→Ummer`; `Kumar Mishra` correctly untouched. Evidence: [`cursor/SCREEN-BIAS-REPORT.md`](../cursor/SCREEN-BIAS-REPORT.md). |
| 21 | Clipboard fallback on paste failure | ✅ | **Yes** | Code-read | `notifyDictationInsertFailure` in `executeDictation.ts` → `clipboard.writeText` + overlay hint. |
| 22 | Privacy Mode / Zero Data Retention | ❌ | No | Code-read | No privacy-mode pref. STT is always cloud OpenAI (`voiceStreaming.service.ts`). |
| 23 | HIPAA BAA in-app | 🚫 | Later | Plan | Phase 12 in FINAL plan — not implemented. |
| 24 | SOC 2 / ISO 27001 | 🚫 | Later | Plan | External certs — not in repo. |
| 25 | Local (not cloud-screenshot) context | ⚠️ | Local path exists | Code-read | Same as #20. Trust differentiator is real in architecture; not a Settings → Privacy toggle yet. |
| 26 | Stop→paste latency (Wispr ASR+LLM &lt;700 ms p99) | ⚠️ | **No** — **not Wispr-class** | Live evening 2026-08-20 | **Code Phases 0–3 done; &lt;700 ms NOT hit.** Live: `backend_pipeline` stt+llm **~1.8–3.1 s**; `post_stt_total` often **~5–8 s**. Shipped: latency logs, mid-speech upload-only, AI fastpath/1.2s fail-open, server STT+clean on `voice:end`, skip 2nd rewrite when `cleaned=1`, insert-diag default OFF. Insert/focus unchanged. Phase 4–5 + faster STT still open. **Phase 4 partial (later 2026-08-20):** screen bias moved off the critical path (measured **p50 246 ms / p90 310 ms** removed; OCR itself only ~87 ms), `cleaned=1` Layer2a gap fixed (was still paying ~0.8–1.5 s), temporal `single_no` resolved locally, diag confirmed OFF. **Still not &lt;700 ms — `stt_ms` alone (~1.0–2.2 s) exceeds the whole budget, so this is blocked on a faster STT path (Phase 3b, backend), not on desktop work.** Detail: [DICTATION-LATENCY-PLAN.md](./DICTATION-LATENCY-PLAN.md) · [DICTATION-LATENCY-REPORT.md](../cursor/DICTATION-LATENCY-REPORT.md). |

---

## Production-ready for a Windows beta (if installer + public API exist)

These are **in code and intended to ship** on the dictation track (`RIPPLE_JARVIS` off):

1. Shift+Space dictation → Whisper → cleanup → insert  
2. F9 Transforms (highlight + voice rewrite)  
3. Snippets (UI + trigger + account sync)  
4. Notes (UI + dictate into note + sync)  
5. Manual dictionary + per-process Styles (Very Casual→Formal) + language picker  
6. Clipboard copy on insert failure  
7. 20-minute session grouping  
8. Account login + cloud STT  

**Not** production-ready even though some code exists: language auto-detect quality, **Wispr-class stop→paste latency**, meeting system audio edge cases, undo, dictation clipboard history, Auto Flow, usage streaks, Privacy Mode, Jarvis.

---

## Highest-priority remaining (Windows only)

1. Mic device selection + language reliability (English hint) — STT hearing the wrong source / wrong language  
2. **Dictation latency (row 26)** — Phases **0–3 code done**; **&lt;700 ms not achieved**. Next: Phase 4 OCR/UX budgets + **faster STT** (see [DICTATION-LATENCY-PLAN.md](./DICTATION-LATENCY-PLAN.md))  
3. Undo AI / show raw transcript  
4. Dictation clipboard history (every utterance)  
5. Auto Flow (optional send in WhatsApp/Slack)  
6. Dictionary auto-learn without Jarvis  
7. Meeting system-audio reliability (DXGI / loopback edge cases)  

Do **not** start Mac/iOS/HIPAA until the Windows beta checklist in `PRODUCTION-LAUNCH-CHECKLIST.md` is green.

---

## Live evidence from this machine (2026-08-18)

From `npm run dev` + backend logs — confirms pipeline is **alive**, not that transcription is *accurate*:

- `hotkey skipped (Jarvis off): CommandOrControl+Space`
- `hotkey registered: Shift+Space` / `F9`
- `[ripple-sync] initial push` / `pull applied`
- Overlay visible; dictation ran
- Whisper returned `"Thank you for watching."`, `"www.microsoft.com"`, empty transcript — **wrong content**, audio still reached the server
- `[ripple-overlay] meeting capture ... systemAudio=OFF`
- Insert abort: `insert_aborted:target_not_visible`

That is why #11 is ⚠️ and language work is P0 — the mic/STT path runs; quality is not Wispr-class.
