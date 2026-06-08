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

## Phase 3.5 — CDP automation (WhatsApp, etc.)

Ripple uses **CDP** to control WhatsApp Web:

1. **Fully quit** Ripple from tray → `npm run dev` → confirm `build phase-3.5-cdp-v3`.
2. On first WhatsApp command, Ripple opens a **dedicated Chrome** (separate profile at `%LOCALAPPDATA%\ripple-cdp-chrome`) so your normal Chrome can stay open.
3. **Log in to WhatsApp Web once** in that window (QR scan).
4. Optional: use your daily Chrome instead — close all Chrome, then:
   ```text
   chrome.exe --remote-debugging-port=9222
   ```
   Open WhatsApp Web there; Ripple will attach to port 9222 if it is already listening.

Voice example: *"Message Saaliq saying I will reach in 10 minutes"*

## Docs

- Phase 3.5 Cursor spec: [../ripple/3.5CURSOR.md](../ripple/3.5CURSOR.md)
- Phase 3.5 blueprint: [../ripple/3.5new.md](../ripple/3.5new.md)
- Phase 3 E2E: [../ripple/PHASE3_END_TO_END.md](../ripple/PHASE3_END_TO_END.md)
- Backend API: [../ripple-backend/PHASE2_FINAL.md](../ripple-backend/PHASE2_FINAL.md)
