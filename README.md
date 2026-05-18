# Ripple Desktop (Phase 3)

Electron desktop client for the Ripple AI assistant.

## Prerequisites

- Node.js 20+
- [ripple-backend](../ripple-backend) running on `http://localhost:3001`

## Setup

```bash
cd ripple-desktop
cp .env.example .env
npm install
```

## Development

```bash
# Terminal 1 — backend
cd ../ripple-backend
npm run dev

# Terminal 2 — desktop
cd ../ripple-desktop
npm run dev
```

## Week 1 features

- Login (tokens stored in OS keychain via keytar)
- Session start on login
- System tray (stay in background)
- Global shortcut `Ctrl+Space` → voice overlay pill
- Close main window → hides to tray (app keeps running)

## Phase 3 doc

See [../ripple/phase3.1.md](../ripple/phase3.1.md) and backend API [../ripple-backend/PHASE2_FINAL.md](../ripple-backend/PHASE2_FINAL.md).
