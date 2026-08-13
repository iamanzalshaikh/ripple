# Phase 10.2 — Meeting Notetaker (FINAL for client demo)

**Status:** FINAL — mic + analysis pack + diarization + consent + live note UI refresh  
**Date:** 2026-07-29 (updated)  
**Hotkey:** `Ctrl+Shift+M` (also triple-tap Shift+Space)

---

## What ships (client demo)

| Feature | Status |
|---------|--------|
| Privacy consent before first record | Done |
| Mic capture | Done (mic-only) |
| System audio (Zoom/Teams speakers) | **Off** — DXGI loopback unreliable on this GPU |
| Live transcript into Flow Note (~10s chunks) | Done |
| Live Notes UI refresh (`notes:bodyAppended`) | Done |
| **Speaker diarization** (`gpt-4o-transcribe-diarize`, Whisper fallback) | **Done (shipped)** — not deferred |
| **Sentiment** (overall + score + rationale) | Done |
| **Decisions** + **Open questions** | Done |
| **Key facts** (concrete amounts / docs / promises — no soft paraphrases) | Done |
| **Key topics** (3–5 tags) | Done |
| **Action items** with owner / due / confidence / evidence | Done |
| **Talk time** % per speaker (speech seconds, not wall-clock) | Done |
| Flow Bar red recording UI + elapsed time | Done |
| Tray red icon + Stop Meeting | Done |
| Note write mutex + verify + sync | Done |

---

## Note shape (after stop)

```markdown
<!-- meeting:<uuid> -->

## Summary
… (must keep amounts, documents, promises — not "personal issues")

## Sentiment
…

## Decisions
…

## Key facts
- ₹3000 and documents reported missing
- …

## Action items
- Task  
  (owner: Speaker A · due: tomorrow 9pm · confidence: high (80%))
  _Evidence: "…" _

## Open questions
…

## Key topics
`…`

## Talk time
- **Speaker A:** 94.4% (50.4s)   ← active speech only; wall clock may be longer

## Transcript
[00:01] Speaker A: …
```

---

## Hard retest checklist (do before calling it reliable)

| # | Test | Pass if |
|---|------|---------|
| 1 | **Real 2-person** conversation (not one person doing two voices) | Speaker A/B labels match who spoke |
| 2 | Speak concrete facts: “₹3000 missing, documents gone, I’ll pay online” | Summary + **Key facts** keep ₹3000 / documents / repayment — not soft “personal issues” |
| 3 | YouTube/music playing in another tab (mic-only) | Note stays mostly on *your* speech; flag if heavy bleed |
| 4 | Hinglish / Hindi + English mix | Diarize + analysis still usable |
| 5 | Record ≥90s, stop, leave note open | UI updates live (Summary appears without re-open) |
| 6 | Repeat #1–#2 twice more (n≥3) | Same quality — not a one-off |

---

## Client quick script

```bash
# Terminal 1
cd ripple-backend && npm run dev

# Terminal 2
cd ripple-desktop && npm run dev:fresh
```

1. **Ctrl+Shift+M** → consent if needed → speak ≥60s with another person if possible  
2. Expect terminal: `chunk ok … diarized=true` then `analysis prepended`  
3. Stop → note has all sections above `## Transcript`

```bash
npx vitest run electron/agent/meeting/__tests__/meetingRecorder.spec.ts
```

---

## Pipeline

```
Ctrl+Shift+M
  → consent → Flow Note
  → mic MediaRecorder (continuous flush)
  → /voice/meeting/transcribe (diarize → Whisper fallback)
  → append + notify Notes UI
  → stop → /voice/meeting/summarize (fidelity + keyFacts)
  → prepend analysis + sync + notify Notes UI
```

**Env:** `OPENAI_MEETING_TRANSCRIBE_MODEL` (default `gpt-4o-transcribe-diarize`).

---

## Known limits

- Mic-only: remote Zoom/Teams audio only if loud enough for the room mic  
- Speaker labels can drift across ~10s chunks  
- Talk-time = summed speech segments (silence excluded) — may be &lt; wall-clock duration  
- System audio / live type-as-you-speak still deferred  
- Diarization quality needs multi-person verification (see hard retest #1)
