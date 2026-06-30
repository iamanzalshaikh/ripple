# P8b+ — Testing guide (embeddings + Gmail/Slack + voice)

## 0. Restart everything

```powershell
cd c:\Users\ANZAL\Desktop\projectRipple\ripple-desktop
npm run dev
```

Reload the Chrome extension after this update:

1. Open `chrome://extensions`
2. Find **Ripple Bridge** → click **Reload** (version should be **1.7.0**)
3. Confirm native host still connected (Ripple terminal log: `Native Messaging host connected`)

---

## 1. Automated tests (run first)

```powershell
cd c:\Users\ANZAL\Desktop\projectRipple\ripple-desktop

npx vitest run electron/automation/retriever/__tests__/p8b-embeddings.spec.ts electron/automation/voice/nlu/__tests__/semantic-voice-routing.spec.ts electron/automation/retriever/__tests__/phase-p8-semantic.spec.ts --maxWorkers=1
```

All should pass.

---

## 2. Seed test memory (DevTools — fastest)

1. In Ripple app, press **F12** (DevTools)
2. Console tab, paste:

```javascript
const r = await window.ripple.memory.seedP8bTest();
console.log(r);
```

Expected: `ok: true` with paths under `%TEMP%\ripple-p8b-manual-*`

3. Probe embeddings:

```javascript
await window.ripple.memory.probeSemantic("Open PDF I discussed with Ahmed");
await window.ripple.memory.probeSemantic("that thing Sarah sent");
```

Expected: `embeddingPaths` includes the Ahmed PDF path; `semanticRefs` includes Sarah slack summary.

---

## 3. Voice commands (after seed)

Press **Ctrl+Space** (or your voice hotkey) and say **exactly**:

| # | Say this | Expected |
|---|----------|----------|
| 1 | `Open PDF I discussed with Ahmed` | Opens `ahmed-quarterly-proposal.pdf` |
| 2 | `Open that thing Sarah sent` | Clarify or best match from Sarah slack ref |
| 3 | `Remember my Goa trip was March 15 2025` | Reply: `Remembered life event: Goa trip` |
| 4 | `Open pdf before my Goa trip` | Opens `goa-packing-checklist.pdf` |

### Logs to confirm (Ripple terminal)

```
[ripple-desktop] P8 semantic → N hit(s) for "Open PDF I discussed with Ahmed"
[ripple-desktop] Smart search "semantic_..." → C:\...\ahmed-quarterly-proposal.pdf
[ripple-desktop] P8 life-event filter → before "Goa trip"
[ripple-desktop] P8 cross-app ingest → slack | Sarah shared...
```

---

## 4. Manual cross-app ingest (no extension)

DevTools console:

```javascript
await window.ripple.memory.ingestCrossApp({
  appId: "gmail",
  summary: "Ahmed sent invoice Q4 PDF attachment",
  contact: "ahmed",
  command: "Gmail: Ahmed invoice"
});
```

Then voice: **`Open PDF I discussed with Ahmed`** (should rank invoice-related memory higher if you also opened that file).

---

## 5. Gmail extension hook (live)

1. Open **https://mail.google.com** in Chrome (same profile as extension)
2. Open any email thread with a subject + sender
3. Ripple terminal should show within ~2s:

```
[ripple-desktop] P8 cross-app ingest → gmail | Email: <subject> ...
```

4. Chrome DevTools on Gmail page → Console may show: `[ripple-gmail] ingest queued ...`

---

## 6. Slack extension hook (live)

1. Open **https://app.slack.com** 
2. Open a channel where someone shared a file or sent a message
3. Ripple terminal:

```
[ripple-desktop] P8 cross-app ingest → slack | <name> shared file: ...
```

---

## 7. Real-world WhatsApp path (builds contact memory)

1. Send a PDF to a contact named **Ahmed** on WhatsApp Web
2. Wait for send to complete
3. Say: **`Open PDF I discussed with Ahmed`**

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No `P8 cross-app ingest` from Gmail | Reload extension v1.7.0; refresh Gmail tab |
| Native host disconnected | Restart `npm run dev`; reload extension |
| Voice opens wrong file | Run `seedP8bTest()` again; check `probeSemantic` output |
| Empty semantic hits | Open the file once manually so path exists on disk |

---

## DB location

`%LOCALAPPDATA%\Ripple\ripple.db` — tables: `semantic_embeddings`, `semantic_refs`, `activity_log`, `life_events`
