# Ripple Chrome Bridge setup (WhatsApp + YouTube + LinkedIn + Instagram)

Ripple controls **your** Chrome via the Ripple extension and Native Messaging (not a separate debug Chrome).

**Used for:** WhatsApp Web, YouTube auto-play, **LinkedIn post composer**, **Instagram DMs**.

## Requirements

- **Google Chrome** (same browser you use daily)
- **WhatsApp Web** logged in at [web.whatsapp.com](https://web.whatsapp.com)
- **Ripple extension** loaded (unpacked)
- **Native Messaging host** installed (Windows script)
- **Ripple desktop** running (`npm run dev`)
- Microphone allowed for voice (Ctrl+Space)

## Setup steps

### 1. Load extension

1. Chrome → `chrome://extensions`
2. **Developer mode** ON
3. **Load unpacked** → folder `ripple-desktop/ripple-chrome-extension` (not the parent `ripple-desktop` folder)
4. Copy the **Extension ID**

### 2. Install Native Messaging host (Windows, once)

PowerShell:

```powershell
cd c:\Users\ANZAL\Desktop\projectRipple\ripple-desktop\native-host
.\install-windows.ps1 -ExtensionId "YOUR_EXTENSION_ID_HERE"
```

Requires **Node.js** on PATH.

### 3. Open WhatsApp

In the **same Chrome**, open **https://web.whatsapp.com**, scan QR if needed, dismiss popups (e.g. “Your chats are private” → OK).

### 4. Start Ripple

```bash
cd ripple-desktop
npm run dev
```

Look for:

```text
[ripple-desktop] Native Messaging bridge on 127.0.0.1:...
[ripple-desktop] Native Messaging host connected
```

### 5. Pin extension (optional)

Pin **Ripple Bridge (WhatsApp + YouTube + LinkedIn + Instagram)** in Chrome for easier reload after updates.

### 5b. LinkedIn (post composer)

1. Open **https://www.linkedin.com/feed/** in the **same Chrome** (logged in).
2. After any Ripple update: **Reload extension** at `chrome://extensions` (manifest must include `linkedin.com`).
3. Desktop log must show: `Native Messaging host connected`.
4. **Click the LinkedIn feed tab** so it is focused, then use Ripple voice (Ctrl+Space).
5. Say: *"Create a new post"* or *"Create post"* → extension should click **Start a post** and open the composer.

If you see `LinkedIn composer timed out (45s)`:

- Reload extension at `chrome://extensions`
- Confirm LinkedIn feed is open (not a PDF or another site in that tab)
- Confirm desktop log shows `Native Messaging host connected` (not just bridge port)
- Try again with the **feed** visible at the top (scroll to top first)

| You say (on LinkedIn tab) | What happens |
|----------------------------|--------------|
| `Create post` / `Create a new post` | Opens post composer (draft) |
| `Create LinkedIn post about AI trends` | AI writes text → opens composer → inserts |
| `Draft post saying Hello team` | Inserts "Hello team" in composer |
| `Search Jasmine Pathan` | Opens people search for that name |
| `Search people named Sarah on LinkedIn` | People search (works without LinkedIn tab focused) |

### 6. YouTube auto-play

1. Open **https://www.youtube.com** in the same Chrome (logged in optional).
2. After code updates: **Reload extension** at `chrome://extensions`.
3. Ripple log must show: `Native Messaging host connected`.
4. Say: *"Play Ertugrul episode 1 on YouTube"* → search opens → extension clicks best match.

If you see `extension bridge offline` or `timed out (25s)` → repeat steps 1–3.

---

## Voice examples

Ripple uses **only what you say** for the message body (not AI fillers like “How are you, Name”).

| You say | Opens chat | Types | Sends |
|--------|------------|-------|-------|
| `Message Noor` | Yes | — | No |
| `Message Noor hello` | Yes | `hello` | No (draft) |
| `Send Noor good night` | Yes | `good night` | Yes |
| `Search Abhishek and say how are you` | Yes | `how are you` | No (draft) |
| `Search Dr. Fatima and say how are you` | Yes | `how are you` | No (draft) |
| `Ask Abhishek are you free` | Yes | `are you free` | No (draft) |

**Send vs draft**

- **`Send …`** → types then presses send (only if you included message words).
- **`Message …`** or **`Search … and say …`** → draft only (does **not** send unless you said “send”).

**Clipboard**

- If you copied text and say “paste from clipboard” / “clipboard”, Ripple can use clipboard content (when the command mentions clipboard).

---

## Notes

- Contact name should exist in your WhatsApp chat list or search results.
- If the right panel shows **“Download WhatsApp for Windows”**, click the contact once in the **left list** manually, then retry.
- Reload the extension after `content.js` changes (`chrome://extensions` → Reload).
- Keep one WhatsApp tab open in Chrome; avoid dozens of duplicate tabs if possible.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Native Messaging not connected | Re-run `install-windows.ps1` with correct Extension ID |
| `Access to the specified native messaging host is forbidden` | Extension ID mismatch |
| WhatsApp tab not open | Open web.whatsapp.com in same Chrome |
| `ENOBUFS` / too many processes | `Get-Process node,electron \| Stop-Process -Force`, then one `npm run dev` |
| Chat not opening | Open that chat manually once; say full contact name (e.g. “Abhishek work”) |
| Wrong / duplicate text | Reload extension v1.2.9+; say message clearly after “say” or “send” |

---

## Dev only

```env
RIPPLE_USE_CDP=1
```

Uses CDP debug port — not for end users.

```env
RIPPLE_USE_WS_BRIDGE=1
```

Legacy WebSocket bridge — not for production.
