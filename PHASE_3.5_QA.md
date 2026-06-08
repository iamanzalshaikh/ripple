# Phase 3.5 — QA smoke checklist (Windows)

Run after `npm run dev` + reload Chrome extension at `chrome://extensions`.

Mark each: **PASS** / **FAIL** / **SKIP**

## Setup

- [ ] Desktop shows `Native Messaging host connected`
- [ ] Extension enabled + native host installed (`WHATSAPP_SETUP.md`)

## WhatsApp

- [ ] Search contact + draft message
- [ ] Send message (`… and send`)
- [ ] Rephrase emotional tone in open chat

## Gmail

- [ ] `Write mail to X@gmail.com subject … saying …` opens compose
- [ ] Rephrase in compose body (in-place replace)

## Desktop

- [ ] `Open Downloads`
- [ ] `Open Resume.pdf` (or a file you have)

## Notion

- [ ] On Notion tab: create documentation (paste clipboard)
- [ ] New page via `notion.new`

## YouTube

- [ ] Search on YouTube tab
- [ ] `Play … on YouTube` auto-clicks first result

## LinkedIn

- [ ] On feed: `Create post saying …` drafts in composer
- [ ] `Create post … and publish` (optional)
- [ ] `Search Jasmine Pathan on LinkedIn`

## Instagram

- [ ] Inbox → `Message Name saying …`
- [ ] **New user (not in sidebar)** → `Message NewPerson saying hi` (New message modal)
- [ ] **Typo name** → `Message Anzal Sheik saying hi` (fuzzy match for Shaikh/Sheikh)
- [ ] Open thread → free-text message
- [ ] Rephrase: `Make this text more emotional` (full replace, no duplicate)
- [ ] Send: `Message Name saying … and send`

## Failure cases (optional)

- [ ] Wrong contact name → clear error
- [ ] Extension disconnected → clear error
- [ ] No focus / wrong window → clear error

---

**Sign-off:** ___ / ___ apps PASS → Phase 3.5 ready for demo.
