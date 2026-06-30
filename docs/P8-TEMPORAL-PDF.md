# P8 Temporal PDF / File Open — How It Works

Voice examples:

- `Open yesterday pdf I opened` → **temporal search** (calendar window)
- `Open last pdf I opened` → **recall memory** (`last_pdf` slot)
- `Open pdf I opened 2 months ago` → **temporal search** (months window)

## Pipeline (routing)

| Step | File | What happens |
|------|------|----------------|
| 1 | `electron/automation/voice/nlu/preprocess.ts` | Fixes STT noise (`lastpdf`, `open open`, trailing `, I`) |
| 2 | `electron/automation/voice/nlu/pipeline.ts` | Temporal before recall |
| 3 | `electron/automation/retriever/timeRange.ts` | `isTemporalFileOpenQuery`, `isLastOpenedRecallQuery`, `parseTimeRangeFromText` |
| 4 | `electron/automation/desktop/parseSmartSearchCommand.ts` | Builds `smart_search` / `time_ranged` intent |
| 5 | `electron/automation/desktop/parseSessionMemoryCommand.ts` | `recall:pdf` for “last pdf” (not calendar) |

## Search (execution)

| Step | File | What happens |
|------|------|----------------|
| 1 | `electron/automation/desktop/intelligentSearch.ts` | `resolveSmartSearch()` → candidates |
| 2 | `electron/automation/retriever/retriever.ts` | Canonical candidate chain |
| 3 | `electron/storage/activityLog.ts` | `searchActivityPathsInRange` — **when you opened** a file |
| 4 | `electron/storage/desktopHistory.ts` | `searchDesktopHistoryPathsInRange` — fallback from successful commands |
| 5 | `electron/storage/recordFileTouch.ts` | Writes activity on open/send/clarify |

### “Opened” vs “modified”

- **Opened** (`I opened`, `yesterday pdf I opened`): uses `activity_log` + `desktop_history` timestamps.
- **Modified** (`pdf I edited yesterday`): uses file `mtime` from `file_index`.

File download date ≠ open date. A PDF downloaded last month but opened yesterday is found only via activity/history.

## Memory on every open

```
openFile() → recordFileTouch(source: open)
recordDesktopAction() → touchPathFromDesktopData(command, path)
```

Both write to `activity_log` with `created_at = now`.

## Debugging

### Terminal logs

```
desktop intent: smart:temporal_pdf     ← routing OK
temporal opened search → N hit(s)      ← found in activity/history
temporal yesterday pdf — no exact hits, clarify with N recent
```

### SQLite (Ripple DB — not PostgreSQL)

Path: `%LOCALAPPDATA%\Ripple\ripple.db`  
Example: `C:\Users\ANZAL\AppData\Local\Ripple\ripple.db`

Ripple uses **SQLite**, not Postgres. If you see `relation "activity_log" does not exist (SQLSTATE 42P01)`, you queried the wrong database.

```powershell
sqlite3 "$env:LOCALAPPDATA\Ripple\ripple.db" "SELECT path, created_at FROM activity_log ORDER BY id DESC LIMIT 10;"
```

```sql
SELECT path, command, created_at FROM activity_log ORDER BY id DESC LIMIT 20;
SELECT resolved_path, command, created_at FROM desktop_history WHERE status='ok' ORDER BY id DESC LIMIT 20;
```

If `activity_log` has no rows for yesterday, temporal search correctly returns nothing unless you pick from the **recent clarify** list.

## Common failures

| Symptom | Cause | Fix |
|---------|--------|-----|
| Opens wrong file (`openFolder.ts`) | Was routed to semantic/item search | Fixed: `isLastOpenedRecallQuery` |
| `No file found for temporal_pdf` | No opens logged in that time window | Open a PDF, retry; or use clarify picker |
| `recall:pdf` opens today’s PDF | You said “last pdf”, not “yesterday” | Expected — use “yesterday pdf I opened” |
| `item:lastpdf I opened` | STT merged words | Fixed: preprocess `lastpdf` → `last pdf` |
| `recall:pdf` for `lastpdf.io file` | Preprocess split `lastpdf.io` → `last pdf.io` | Fixed: skip split before `.` |

## Tests

```powershell
npx vitest run electron/automation/retriever/__tests__/temporal-opened-search.spec.ts electron/automation/voice/nlu/__tests__/temporal-pdf-routing.spec.ts --maxWorkers=1
```
