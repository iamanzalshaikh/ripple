# P8b — Semantic memory layer

Phase 8b adds **meaning-based recall** on top of P8a metadata recall (last opened, temporal).

## Capabilities

| Voice example | How it works |
|---------------|--------------|
| "Open PDF I discussed with Ahmed" | `semantic_topic` → activity_log contact + semantic_index BM25 rank |
| "Open pdf before my Goa trip" | Life event window + activity paths before `event_at` |
| "Remember my Goa trip was March 2025" | Stores row in `life_events` |
| "That thing Sarah sent" (with path ingest) | Cross-app `activity_log` + semantic index |

## Architecture

```
Voice → preprocessForNlu → parseSemanticOpenCommand
      → smart_search (semantic_topic) → retrieveFileCandidates
      → activity_log + semantic_index seed
      → semanticRankCandidates (BM25-lite + overlap + recency)
      → optional life_events time filter
      → openSmartSearchResult
```

## Storage

| Table | Purpose |
|-------|---------|
| `semantic_index` | path, tokens, snippet (command + contact + file text) |
| `activity_log` | path, contact, app_id, command, summary |
| `life_events` | label, topic, event_at — user-tagged milestones |

## Cross-app ingest (extension / IPC)

```typescript
// Electron IPC: memory:ingest-cross-app
{
  appId: "slack" | "gmail" | "email" | "whatsapp" | "teams" | "outlook",
  summary: "Sarah shared contract draft",
  path?: "C:\\...\\contract.pdf",
  contact?: "sarah"
}
```

Chrome extension can call this when user views/downloads an attachment.

## Ranking

`semanticVectorRank.ts` — BM25-lite lexical rank (no native sqlite-vec required on Windows).
Future: optional sqlite-vec embeddings when dependency is bundled.

## Tests

```powershell
npx vitest run electron/automation/retriever/__tests__/phase-p8-semantic.spec.ts electron/automation/voice/nlu/__tests__/semantic-voice-routing.spec.ts --maxWorkers=1
```

## Manual voice checklist

1. Send a PDF to Ahmed on WhatsApp (builds contact + path in activity_log)
2. Say: **"Open PDF I discussed with Ahmed"**
3. Say: **"Remember my Goa trip was March 15 2025"**
4. Open a Goa packing PDF, then: **"Open pdf before my Goa trip"**

Log marker: `P8 semantic → N hit(s)` or `P8 life-event filter → before "Goa trip"`
