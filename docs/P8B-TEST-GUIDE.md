# P8b+ — Testing guide (embeddings + Gmail/Slack/Outlook/Teams + voice)

## Quick start (3 steps)

```
Step 1 → npm run dev          (Ripple app running)
Step 2 → npm run seed:p8b     (fills test memory — run in a 2nd terminal)
Step 3 → Ctrl+Space in Ripple → say a command from the list below
```

Reload Chrome extension **1.9.0** once if you have not already (`chrome://extensions` → Reload).

---

## All 9 voice commands (after seed)

Run `npm run seed:p8b` first. Then say each command in Ripple:

| # | Say this | What should happen |
|---|----------|-------------------|
| 1 | `Open PDF I discussed with Ahmed` | Opens `ahmed-quarterly-proposal.pdf` |
| 2 | `Open that thing Sarah sent` | Opens Sarah's contract PDF or clarifies |
| 3 | `Open pdf before my Goa trip` | Opens `goa-packing-checklist.pdf` (life event filter) |
| 4 | `Open email from MongoDB Atlas` | Opens Gmail search or remembered Atlas thread |
| 5 | `Open the Naukri shortlist email` | Opens Gmail search for Naukri shortlist |
| 6 | `Open email about job shortlist` | Same Naukri thread (subject variant) |
| 7 | `Open Gmail thread with pdf attached` | Opens local `atlas-quarterly-report.pdf` |
| 8 | `Open pdf Ahmed sent` | Opens local `ahmed-invoice.pdf` |
| 9 | `Open attachment from Sarah` | Opens Sarah's contract PDF |

**Bonus (life event write):** `Remember my Goa trip was March 15 2025` — stores/updates life event.

### Logs to watch (`npm run dev` terminal)

```
desktop intent: smart:...              → semantic file open (#1–3)
desktop intent: gmail_email:...          → Gmail sender (#4)
desktop intent: gmail_subject:...        → Gmail subject (#5–6)
desktop intent: gmail_attachment:pdf     → attachment (#7)
desktop intent: cross_app_attachment:...   → local attachment (#8–9)
```

---

## Seed command

```powershell
cd c:\Users\ANZAL\Desktop\projectRipple\ripple-desktop
npm run seed:p8b
```

Prints folder paths + probe results for all 9 commands.

Or in Ripple DevTools (F12):

```javascript
const r = await window.ripple.memory.seedP8bTest();
console.log(r.data.voiceCommands);
```

---

## Flow diagram

```
npm run seed:p8b
       │
       ▼
  ripple.db gets fake Ahmed/Sarah/Goa files + Gmail refs + attachment paths
       │
       ▼
  Ctrl+Space → voice command
       │
       ├── semantic (#1–3)     → search embeddings → open local PDF
       ├── gmail sender (#4)     → semantic ref → Gmail URL
       ├── gmail subject (#5–6)  → semantic ref → Gmail URL
       └── attachment (#7–9)     → local file in seed folder first, else Gmail
```

**Live browser ingest** (optional, separate from seed): open real Gmail/Slack in Chrome → extension writes to same DB → then voice recall works on real emails too.

---

## Live browser tests (extension, not seed)

| App | Do this in browser | Expected log |
|-----|-------------------|--------------|
| Gmail | Open any email thread | `P8 cross-app ingest → gmail` |
| Gmail | Thread with PDF | `... (+1 attachment(s))` |
| Gmail | PDF auto-downloads | File in `Downloads/Ripple/attachments/` |
| Slack | Open channel with file share | `P8 cross-app ingest → slack` |
| Outlook | Open email in reading pane | `P8 cross-app ingest → outlook` |
| Teams | Open chat with attachment | `P8 cross-app ingest → teams` |

---

## Automated tests

```powershell
npx vitest run electron/storage/__tests__/p8b-seed-cli.spec.ts electron/automation/gmail/__tests__/parseOpenCrossAppAttachment.spec.ts --maxWorkers=1
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Voice opens nothing | Run `npm run seed:p8b` again (clears + re-seeds) |
| Wrong file opens | Check seed output folder in terminal |
| No Gmail ingest | Reload extension v1.9.0; refresh Gmail tab |
| Attachment opens Gmail not file | Seed puts files under temp folder — run seed first |

---

## DB location

`%LOCALAPPDATA%\Ripple\ripple.db`
