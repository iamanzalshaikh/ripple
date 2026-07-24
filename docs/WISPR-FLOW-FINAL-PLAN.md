# Ripple → Wispr Flow — ONE FINAL Development Plan

**Status:** FINAL / ONLY PLAN — use this single file for all development until full parity  
**File:** `docs/WISPR-FLOW-FINAL-PLAN.md`  
**Last updated:** 2026-07-23  

**How to use:** Follow phases in order. Do **Phase 0–6 first** (Windows MVP). Then 7→13. Do not open other Wispr plans for day-to-day work.

**Effort sizing (no fake calendar dates):**
- **S** = single engineer, a few days, isolated  
- **M** = single engineer, up to ~2 weeks, some integration risk  
- **L** = multi-engineer or multi-week, real test surface  
- **XL** = new subsystem / platform; needs its own scoping kickoff  

Measure real velocity after Phase 0–6, then convert S/M/L/XL → days.

**Supersedes:**
- `WISPR-FLOW-MVP-FINAL-PLAN.md` (merged in)
- `WISPR-FLOW-FULL-PARITY-PLAN.md` (merged in)

---

## 0. Product definition

**MVP claim (ships first — Phase 0–6):**Learn that Noor is Noor.
> Hold **Alt+Space**, speak → corrected text appears in the focused field.  
> Windows voice typing in **WhatsApp, Gmail, Notepad, Cursor**.

**Full-parity claim (end state — through Phase 13):**
> Cross-platform (Windows/Mac/iOS/Android) voice typing with sync, Snippets/Styles/dictionary, Flow Notes + Meeting Notetaker, polished Flow Bar, and enterprise/billing — matching Wispr Flow’s published feature set.

**Frozen forever in this track (separate roadmap):** OS agent expansion, Semantic Intent Router, Wave 0/1 agent polish, P9 Jarvis.  
Ctrl+Space = agent only. Never merge into dictation.

---

## 1. Closeness scores (re-measure after each phase)
Learn that Noor is Noor.
| Measuring | % today | Notes |
|-----------|---------|-------|
| Full Wispr Flow product | ~18–22% | Recalculate after each phase |
| Core Windows Wispr feel | ~55–65% | Unproven until Phase 1 matrix green |Learn that nor means Noor.

**Do not claim full Wispr parity at MVP.**

---Learn that nor means Noor.

## 2. Current state — Ripple P7 (baseline)

### Working todayLearn Noor means Noor.
| Area | Evidence |
|------|----------|
| Whisper/STT | Live |
| Dual hotkeys | Alt+Space dictation, Ctrl+Space agent |Learn Noor means Noor.Learn Noor means Noor.Learn Noor means Noor.
| Overlay mode banner | Command vs Dictation |
| Dictation skips planner | `executeDictation` |
| Revision buffer | `dictationSession` |
| Correction analyze/generate | P7.2 / `wispr.md` |Learn Noor means Noor.
| Fail-open to literal | Present |
| OS insert ladder | Code landed |
| WhatsApp / Gmail compose | Live green (**re-verify**) |
| Native hands | `P7-FEATURES.md` |Learn that Dr. Fatima means Tatheer.
| P6 corrections in rewrite | Wired; live name demo open |

### Partial
| Area | Gap |Learn that Noor means light.
|------|-----|
| Any text field | Only 2 apps proven |
| Filler/punct/lists | Weaker than Wispr |
| Context-aware names | Live `nor→Noor` open |Learn Tathir means Tathir.
| Notepad / Cursor | Not proven live |
| Overlay | ≠ polished Flow Bar |
| “Command mode” | Agent Ctrl+Space ≠ Wispr rewrite-selection |
Learn Tathir means Tathir.Learn Tathir means Tathir.
### Missing (desktop + later)
| Area | Notes |
|------|-------|Learn Tathir means Tathir.
| 100+ languages + bar language picker | Missing |
| Quiet / whisper mode | Missing |
| Mac / iOS / Android + sync | Missing |
| 20-min sessions as product | Missing |Learn Tathir means Tathir.
| Snippets / Styles | Missing |
| Dictionary UX | Hooks only |
| Flow Notes / Meeting Notetaker | Missing |
| iOS widgets / Siri / Action Button / Flow Bubble | Missing |Learn Tathir means Tathir.
| SSO / HIPAA / MDM | Missing on Ripple; Wispr SSO confirmed; **SCIM unverified** on Wispr |
| Billing / referral / self-serve deletion | Missing |

### Apps — MVP gate
| App | Status |
|-----|--------|
| WhatsApp | live green (re-verify) |
| Gmail | live green (re-verify) |
| Notepad | **not proven** |
| Cursor | **not proven** |

**Honest count today: 2 of 4.**

---

## 3. Wispr feature inventory (source-verified 2026-07-23)

### Source check
| Wispr claim | Check |
|-------------|-------|
| Flow Notes, Flow Bar | **Confirmed** |
| Meeting Notetaker (system audio; Private Cloud Sync) | **Confirmed** |
| iOS Action Button, Siri, Lock Screen, Spotlight | **Confirmed** |
| 20-minute sessions | **Confirmed** |
| In-Flow-Bar language picker | **Confirmed** |
| Snippets, Styles, dictionary, cleanup | **Confirmed** |
| Flow Bubble (Android) | **Unconfirmed** independently |
| Highlight + voice-edit | **Command Mode** (pricing) / **Transforms** (newer) |
| SCIM | **Unverified** (SSO/SAML confirmed) |
| Exactly “5 sign-in methods” | **Unverified** |
| Help center “~112 articles” | **Estimate only** |

### Feature → lane (what you build when)

| Feature | Lane |
|---------|------|
| Windows insert in 4 apps + corrections + personal names | **MVP (0–6)** |
| Snippets, Styles, dictionary UI, longer sessions, more apps | **Phase 7** |
| Highlight + voice rewrite (Transforms) | **Phase 8** |
| Sync + Mac + iOS + Android + languages | **Phase 9** |
| Flow Notes + Meeting Notetaker | **Phase 10** |
| Full Flow Bar polish | **Phase 11** |
| Enterprise SSO / HIPAA / MDM (/ SCIM if reconfirmed) | **Phase 12** |
| Billing / referral / deletion / sign-in | **Phase 13** |

---

## 4. Phase map + dependencies

```
Phase 0–6   MVP Windows 4 apps              ← DO THIS FIRST
Phase 7     Personalization                 Snippets / Styles / Dictionary / sessions
Phase 8     Command Mode / Transforms       highlight + voice-edit
Phase 9     Sync + Mac / iOS / Android
Phase 10    Flow Notes + Meeting Notetaker
Phase 11    Flow Bar full polish
Phase 12    Enterprise
Phase 13    Billing / account / growth
```

**Dependencies:**
- 9.1 sync blocks → Notes sync + platform sync  
- Phase 8 blocks → Flow Bar wand (11.4)  
- 9.5 language logic blocks → bar picker (11.2)  
- 10.1 Notes blocks → Scratchpad button (11.3)  
- Phase 9 platforms block → iOS/Android extras  
- 12 + 13 after core stable; can run in parallel with each other  

---

## 5. MVP — Phases 0–6

### Phase 0 — Freeze — **S**
- [ ] No Semantic / OS / Wave / Jarvis until MVP ships  
- [ ] All demos use **Alt+Space** only  
- [ ] Native hotkey works (`npm run native:build` if needed)  

**Ship gate:** Team uses only this plan; agent work frozen.

### Phase 1 — Insert matrix (BLOCKER) — **M**
| # | Surface | Pass |
|---|---------|------|
| 1 | Notepad | [ ] |
| 2 | Cursor | [ ] |
| 3 | WhatsApp compose | [ ] |
| 4 | Gmail compose | [ ] |
| 5 | Insert logs show OS strategy ok | [ ] |

**Ship gate:** All 4 apps green in one sitting.

### Phase 2 — Corrections live — **S**
| # | Check | Pass |
|---|-------|------|
| 1 | “no no” course-correction | [ ] |
| 2 | No intermediate scraps typed | [ ] |
| 3 | Ambiguous → fail-open literal | [ ] |

**Ship gate:** Rows 1–3 green every time.

### Phase 3 — Personal name — **S**
| # | Check | Pass |
|---|-------|------|
| 1 | Learn nor→Noor | [ ] |
| 2 | “hi nor” → “hi Noor” | [ ] |

**Ship gate:** Live name demo recorded.

### Phase 4 — Hard walls — **S**
| # | Check | Pass |
|---|-------|------|
| 1 | Alt+Space never wakes agent | [ ] |
| 2 | Ctrl+Space still opens Chrome | [ ] |
| 3 | Focus restored to target field | [ ] |

**Ship gate:** Dictation cannot be confused with Jarvis.

### Phase 5 — Thin product shell — **S**
- [ ] First-run: hold Alt+Space and speak  
- [ ] Privacy line (cloud STT; no silent screenshot context)  
- [ ] Known limits (Windows; admin UIs unsupported; name only proven apps)  

**Ship gate:** Stranger succeeds in ~2 minutes.

### Phase 6 — Soft launch — **S**
Ship when Phase 1–5 + §6 matrix are all green.

**MVP success:** Text appears in WhatsApp/Gmail/Notepad/Cursor; agent sleeps.  
**MVP failure:** Flaky insert / wrong window / sold as Jarvis.

---

## 6. MVP manual matrix (must pass before Phase 7)

| # | Action | Expect | Pass |
|---|--------|--------|------|
| 1 | Alt+Space → Notepad → “hello world” | Types | [ ] |
| 2 | Alt+Space → Cursor → sentence | Types | [ ] |
| 3 | Alt+Space → WhatsApp | In compose | [ ] |
| 4 | Alt+Space → Gmail | In body | [ ] |
| 5 | “tomorrow no no day after” | One corrected sentence | [ ] |
| 6 | After nor→Noor, “hi nor” | “hi Noor” | [ ] |
| 7 | Ctrl+Space → open chrome | Opens Chrome | [ ] |
| 8 | Alt+Space → no workflow spam | No planner | [ ] |
| 9 | Focus restore after overlay | Correct field | [ ] |
      Www.microsoft.com.

**Ship gate:** Snippets + Styles usable E2E; dictionary UI shipped; ≥3 new apps proven live.  
**Note:** Wispr Styles = English + desktop first — match that before expanding.

---

## 8. Phase 8 — Command Mode / Transforms

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 8.1 | Selection capture | M | MVP insert |
| 8.2 | Voice rewrite instruction (NOT agent/planner) | M | — |
| 8.3 | Rewrite + reinsert | M | 8.1, 8.2 |
| 8.4 | Naming check (Command Mode vs Transforms) | S | — |

**Ship gate:** Highlight → “make this more formal” → updates in MVP apps + ≥1 new app.  
**Hard rule:** Separate code path from Ctrl+Space agent. Never merge.

---

## 9. Phase 9 — Sync + Mac / iOS / Android

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 9.1 | Account + sync backend | XL | own scoping session |
| 9.2a | Mac shell + Accessibility insert | XL | 9.1 |
| 9.2b | Port correction/rewrite to Mac | M | 9.2a |
| 9.2c | Mac insert matrix | L | 9.2b |
| 9.3a | iOS feasibility (keyboard extension likely) | XL | scoping first |
| 9.3b | iOS build | XL | 9.3a |
| 9.4a | Android maturity research vs Wispr | S | — |
| 9.4b | Android build | XL | 9.4a |
| 9.5 | 100+ languages + picker logic | L | STT provider |
| 9.6 | Quiet/whisper STT mode | M | STT provider |
| 9.7 | iOS: widget, Siri, Spotlight, Action Button | L each | 9.3b |
| 9.8 | Android Flow Bubble (after reconfirm) | M | 9.4b |

**Ship gate:** One account; dictionary/snippets/styles sync across platforms; each platform passes its insert matrix.  
**Treat Phase 9 as its own project kickoff.**

---

## 10. Phase 10 — Flow Notes + Meeting Notetaker

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 10.1 | Flow Notes (synced) | L | 9.1 |
| 10.2a | Mac system-audio capture | L | 9.2a |
| 10.2b | Meeting transcript/summary cloud pipeline + privacy disclosure | M | 10.2a |
| 10.3 | Quick capture (widget / Action Button → note) | M | 9.7 |

**Ship gate:** Dictate a note from any platform → syncs; record a test meeting → usable transcript/summary.

---

## 11. Phase 11 — Full Flow Bar polish

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 11.1 | Replace overlay with floating Flow Bar | L | — |
| 11.2 | Language picker in bar | S | 9.5 |
| 11.3 | Scratchpad / Notes button | S | 10.1 |
| 11.4 | Transforms wand on selection | S | Phase 8 |

**Ship gate:** Flow Bar replaces overlay everywhere; re-run §6 matrix with zero MVP regression.

---

## 12. Phase 12 — Enterprise

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 12.1 | SSO / SAML | L | Wispr-confirmed |
| 12.2 | SCIM | L | **Only if independently reconfirmed** |
| 12.3 | HIPAA BAA | XL legal+infra | counsel early |
| 12.4 | MDM installer (Win then Mac) | L | 9.2a for Mac |
| 12.5 | Admin console (seats, billing, usage) | L | 13.1 for billing |
| 12.6 | SOC 2 / ISO (optional) | XL external | separate initiative |

**Ship gate:** Pilot enterprise customer can SSO in; admin manages seats centrally; HIPAA BAA can be executed (in-app or sales process). Do not market SCIM unless reconfirmed.

---

## 13. Phase 13 — Billing / account / growth

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 13.1 | Subscriptions (cancel anytime, period-end access) | L | — |
| 13.2 | Referral program | M | 13.1 |
| 13.3 | Self-serve account + data deletion | M | 9.1 |
| 13.4 | Your own sign-in method list (do not assume Wispr’s “5”) | S | 9.1 |

**Ship gate:** Self-serve signup → paid conversion → cancel → data deletion, with no human in the loop.

---

## 14. Frozen dictation pipeline

```text
Microphone
  → Whisper STT
  → Dictation gate (Alt+Space only)
  → Revision buffer (dictationSession)
  → Layer 1 signal detector (local)
  → Layer 2A analyze (ambiguous) / 2B generate (tone only)
  → Layer 3 safe rewrite (fail-open literal)
  → P6 voice corrections (spoken → canonical)
  → Confirm final text
  → Focus capture + restore
  → Insert ladder (OS-first)
       1. native SendInput
       2. sendkeys
       3. clipboard select-all + paste
       4. WhatsApp extension fallback only
       5. vision (optional last)
  → Verify (value / growth, not placeholder name)
  → Done
```

**Standing rule (every phase):** Dictation never enters planner / Semantic / open-project — including Sync, Notes, Transforms, Enterprise.

---

## 15. Hotkeys

| Hotkey | Mode | Behavior |
|--------|------|----------|
| **Shift+Space** (+ Ctrl+Shift+Space) | Dictation | Buffer → correct → insert |
| **Ctrl+Space** | Agent Command (≠ Phase 8 Transforms) | Planner / tools |
| **F9** (+ Ctrl+Alt+Space backup) | Transforms (Phase 8) | Select text → speak rewrite → replace |
| **Escape** | Cancel | Abort |

Env: `RIPPLE_P85_DICTATION_MODE=0` forces dictation → command (dev only).

---

## 16. Modules

### MVP reuse (do not rebuild)
| Module | Role |
|--------|------|
| `electron/agent/dictation/dictationSession.ts` | Mode + buffer |
| `electron/agent/dictation/correctionSignalDetector.ts` / `correctionEngine.ts` | Layer 1 |
| `electron/agent/dictation/dictationRewrite.ts` | Orchestrator |
| `electron/agent/dictation/safeRewriteEngine.ts` | Layer 3 |
| `electron/agent/dictation/executeDictation.ts` | STT → rewrite → insert |
| `electron/agent/dictation/prepareComposeText.ts` | Compose prep |
| `electron/storage/voiceCorrections.ts` | Personal corrections |
| `electron/automation/input/inputStrategy.ts` | Insert ladder |
| `electron/automation/smartInsert.ts` / `actions/insertText.ts` | Insert entry |
| `electron/native/*` | SendInput, UIA, hotkeys |

Tests: `phase-p85-p7-whisper-flow.spec.ts`, `phase-p85-p72-production-eval.spec.ts`

### New by phase
| First needed | Module |
|--------------|--------|
| 7.2a | Snippet store |
| 7.3a | Style profile engine |
| 8.1–8.3 | Selection capture + rewrite-in-place |
| 9.1 | Account / sync service |
| 9.2–9.4 | Mac / iOS / Android natives |
| 13.1 | Billing integration |

---

## 17. Risk register

| Risk | Mitigation |
|------|------------|
| iOS system-wide dictation limits | Feasibility 9.3a before timeline |
| SCIM may not exist on Wispr | Reconfirm before build/market |
| SOC 2 / ISO cost & lead time | Separate initiative + vendor quote |
| HIPAA is legal, not a toggle | Counsel at Phase 12 start |
| Meeting Notetaker needs cloud | Explicit privacy disclosure |
| Two “Command” features merge | Hard separate paths in Phase 8 |
| Wispr renames features again | Re-check before public copy |

---

## 18. Week plan (MVP only — first)

| Day | Focus |
|-----|-------|
| 1 | Phase 0 + re-verify WhatsApp/Gmail |
| 2–3 | Notepad + Cursor green |
| 4 | Corrections live |
| 5 | nor→Noor |
| 6 | Walls + thin shell |
| 7 | Full matrix → soft launch decision |

Then start Phase 7.

---

## 19. Decision log

| Date | Decision |
|------|----------|
| 2026-07-23 | Freeze agent; Wispr dictation first |
| 2026-07-23 | MVP = Windows 4-app core |
| 2026-07-23 | Wispr inventory verified; SCIM / 5 sign-ins / ~112 articles flagged |
| 2026-07-23 | Full parity Phases 7–13 added |
| 2026-07-23 | Phase 12 + 13 ship gates added |
| 2026-07-23 | **ONE final plan:** this file supersedes MVP + Full Parity split docs |

---

## 20. Related (engineering reference only — not alternate plans)

- [P8.5-P6-P7-IMPLEMENTATION-PLAN.md](./P8.5-P6-P7-IMPLEMENTATION-PLAN.md) — P7 engineering detail  
- [wispr.md](./wispr.md) — correction layer design  
- [P7-FEATURES.md](./P7-FEATURES.md) — native hands  
- Semantic / OS Control docs — **frozen until Phase 6**  

**Do not use as competing roadmaps (superseded):**
- `WISPR-FLOW-MVP-FINAL-PLAN.md`  
- `WISPR-FLOW-FULL-PARITY-PLAN.md`  
