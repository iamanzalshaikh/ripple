# P8 Last-Opened Memory — How It Works

Voice examples:

- `Open last image I opened` → **recall** (most recent image in activity log)
- `Open image I opened yesterday` → **temporal search** (calendar window)
- `Open last pdf I opened. Open last folder I opened` → **compound** (both steps run)

## What is remembered (even after you close/cut the file)

| Type | Tracked via |
|------|-------------|
| PDF | Browser/Acrobat focus + `activity_log` |
| Image | Photos focus watcher + `activity_log` |
| Video | Photos/player focus + `activity_log` |
| Folder | Explorer focus + `activity_log` |
| Generic file | Ripple open + `activity_log` |

Storage: SQLite `%LOCALAPPDATA%\Ripple\ripple.db` — rows persist for months.

## Recall priority (`p8RecallResolver.ts`)

1. `activity_log` (newest matching kind)
2. `desktop_history`
3. Fresh focus (window title, &lt;20s)
4. Session memory (`last_pdf`, `last_image`, …)

## P8 focus watcher

Polls every 2s while Ripple runs. Logs views into `activity_log` when you switch files in Photos, Explorer, PDF viewer, etc.

Startup log: `P8 focus watcher → every 2000ms (pdf, image, video, folder)`

## Temporal vs last

| Phrase | Route |
|--------|--------|
| Open **last** image I opened | `recall:image` |
| Open image I opened **yesterday** | `smart_search` + activity in time window |
| Open video I opened **2 months ago** | `smart_search` + `months_2_ago` window |

## Compound commands

`compoundParse.ts` splits on `. Open …`, `and`, `aur`, `then`, `phir`.

Each clause parses recall/temporal before generic open — so both steps execute via `workflowRunner.ts`.

## Tests

```powershell
npx vitest run electron/automation/desktop/__tests__/p8-recall-resolver.spec.ts electron/automation/voice/nlu/__tests__/temporal-media-routing.spec.ts electron/automation/voice/nlu/__tests__/compound-recall-exec.spec.ts electron/automation/retriever/__tests__/temporal-opened-search.spec.ts --maxWorkers=1
```

## Debug

```powershell
sqlite3 "$env:LOCALAPPDATA\Ripple\ripple.db" "SELECT path, command, created_at FROM activity_log ORDER BY id DESC LIMIT 15;"
```

Look for `viewed image`, `viewed pdf`, `viewed folder` entries after browsing files manually.
