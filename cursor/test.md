I prepared this as a **Notion-ready QA document format**. You can directly copy-paste it into Notion. It follows your frozen **P8.5 → Phase 5 → P5.1/P5.2/P5.3/P5.4** architecture.

Scope:

```text
P8.5 Phase 5 — Universal Capability Layer E2E Manual QA

Covered:
✅ P5.1 Filesystem Intelligence
✅ P5.2 Desktop Reliability
✅ P5.3 Browser Generic (Production First)
✅ P5.4 Automation Layer

Excluded:
❌ P5.5 AI tools
❌ P6 memory
❌ P7 workflows
```

---

# P8.5-P5 Universal Capability Layer

# Production E2E Voice QA Test Suite

**Version:** 1.0
**Purpose:** Validate Voice → Planner → Validator → Permission → Executor → Tool → Observe pipeline

---

# Test Environment Setup

## Required Flags

```bash
RIPPLE_P85_PLANNER_V2=all
RIPPLE_P85_TOOL_EXECUTOR=1
RIPPLE_INSERT_TEXT_DIAG=1
RIPPLE_P85_VISION_INSERT=1
RIPPLE_USE_CDP=0
```

Production browser testing:

```text
Chrome / Edge
+
Ripple Extension Connected
+
Native Messaging Enabled
```

Apps required:

```text
Notepad
Cursor
Chrome
WhatsApp Web
Windows Terminal
Ripple project
Horizon backend project
```

---

# Expected Pipeline

Every command should follow:

```text
Voice Command

↓

STT

↓

NLU Normalize

↓

Planner v2

↓

ExecutionPlan

↓

planValidator

↓

Permission Engine

↓

Tool Executor

↓

Tool Execution

↓

Observe / Verify

↓

Recovery if failed
```

---

# P5.1 FILESYSTEM INTELLIGENCE TESTS

## FS-001 List Downloads Directory

### Voice Command

```text
Show me all files inside my Downloads folder
```

Expected Tool:

```json
filesystem.list_directory
```

Verify:

* Correct folder resolution
* No web search
* Local filesystem only

---

## FS-002 List Documents

```text
Show me everything inside my Documents folder
```

Expected:

```json
filesystem.list_directory
```

---

## FS-003 Search Resume

```text
Find my resume file inside my computer
```

Expected:

```json
filesystem.search
```

Verify:

* Finds PDF/DOCX
* Returns location

---

## FS-004 Search Project

```text
Find my Horizon backend project folder
```

Expected:

```json
filesystem.search
```

---

## FS-005 Find Authentication Files

```text
Find all authentication related files inside Horizon backend
```

Expected:

```json
filesystem.search
```

---

## FS-006 Read Package Configuration

```text
Read package.json from my Horizon backend project
```

Expected:

```json
filesystem.read_file
```

---

## FS-007 Read Source File

```text
Read auth.service.ts from my backend project
```

Expected:

```json
filesystem.search

filesystem.read_file
```

---

## FS-008 Get File Metadata

```text
Show metadata of package.json in Horizon backend
```

Expected:

```json
filesystem.get_metadata
```

Check:

```text
size
modified date
file type
```

---

## FS-009 Create File

```text
Create a new file called ripple-test.txt inside Documents
```

Expected:

```json
filesystem.create_file
```

Permission:

```text
Confirmation required
```

---

## FS-010 Write File

```text
Write "Ripple P8.5 filesystem testing complete" into ripple-test.txt
```

Expected:

```json
filesystem.write_file
```

Verify:

```text
backup created
undo available
```

---

## FS-011 Patch File

```text
Update ripple-test.txt and replace filesystem testing with capability testing
```

Expected:

```json
filesystem.patch_file
```

Verify:

```text
preview
confirm
undo
```

---

## FS-012 Move File

```text
Move ripple-test.txt from Documents to Desktop
```

Expected:

```json
filesystem.move_file
```

---

## FS-013 Safety Test

```text
Delete all files inside Documents folder
```

Expected:

```text
BLOCKED
```

Reason:

```text
High risk filesystem mutation
```

---

# P5.2 DESKTOP RELIABILITY TESTS

---

# Application Launch

## DT-001 Open Notepad

```text
Open Notepad application
```

Expected:

```json
desktop.launch_app
```

---

## DT-002 Open Cursor

```text
Open Cursor editor
```

Expected:

```json
desktop.launch_app
```

---

## DT-003 Active Window

```text
Tell me what application is currently active
```

Expected:

```json
desktop.get_active_window
```

Verify:

```text
hwnd
title
process
```

---

## DT-004 Focus Cursor

```text
Switch focus to Cursor editor
```

Expected:

```json
desktop.focus_window
```

---

# Typing Reliability

## DT-005 Type Basic Text

```text
Type hello from Ripple desktop automation
```

Expected:

```json
desktop.type_text
```

---

## DT-006 Type Multiline Text

```text
Type first line Ripple test and second line automation success
```

Expected:

```json
desktop.type_text
```

---

## DT-007 Type Code

```text
Type console.log Ripple automation test inside Cursor
```

Expected:

```json
desktop.type_text
```

Verify:

UIA path works.

---

## DT-008 Press Enter

```text
Press Enter to create a new line
```

Expected:

```json
desktop.press_key
```

---

## DT-009 Press Arrow Key

```text
Move cursor three lines upward using arrow keys
```

Expected:

```json
desktop.press_key
```

---

## DT-010 Select All

```text
Select all text in current editor
```

Expected:

```json
desktop.hotkey
```

Shortcut:

```text
CTRL+A
```

---

## DT-011 Copy Text

```text
Copy the selected text
```

Expected:

```json
desktop.hotkey
```

---

## DT-012 Paste Text

```text
Paste copied text into the editor
```

Expected:

```json
desktop.hotkey
```

---

## DT-013 Close Application

```text
Close Notepad
```

Expected:

```json
desktop.close_app
```

---

## DT-014 WhatsApp Typing

```text
Open WhatsApp Web and type hello message in the composer
```

Expected:

```json
desktop.type_text
```

Verify:

Priority:

```text
Extension
↓
UIA
↓
Clipboard
↓
Vision
```

---

# P5.3 BROWSER GENERIC TESTS

Production ladder:

```text
Extension

↓

Desktop Automation

↓

Vision

↓

CDP only when RIPPLE_USE_CDP=1
```

---

# Navigation

## BR-001 Open Website

```text
Open github.com in my browser
```

Expected:

```json
browser.open_url
```

Implementation:

```text
openUrlWithTabResolver()
```

---

## BR-002 Open Documentation

```text
Open React documentation website
```

Expected:

```json
browser.open_url
```

---

## BR-003 Navigate Current Tab

```text
Open YouTube in my current browser tab
```

Expected:

```json
browser.open_url
```

---

# DOM Reading

## BR-004 Extract Page Text

```text
Read visible text from the current webpage
```

Expected:

```json
browser.extract_text
```

---

## BR-005 Extract Article

```text
Open Wikipedia React page and extract the visible content
```

Expected:

```json
browser.extract_text
```

---

# Element Interaction

## BR-006 Find Search Box

```text
Find the search input box on Google
```

Expected:

```json
browser.find_element
```

---

## BR-007 Click Search Box

```text
Click the Google search box
```

Expected:

```json
browser.click
```

---

## BR-008 Type Search Query

```text
Type Ripple desktop automation into Google search
```

Expected:

```json
browser.type
```

---

## BR-009 Submit Search

```text
Press Enter and search Google
```

Expected:

```json
desktop.press_key
```

---

## BR-010 Scroll Website

```text
Scroll down the webpage by one screen
```

Expected:

```json
browser.scroll
```

---

## BR-011 YouTube Search

```text
Open YouTube and search for relaxing music
```

Expected Compound:

```json
browser.open_url

browser.find_element

browser.type

desktop.press_key
```

---

## BR-012 Gmail Read

```text
Open Gmail and show the visible page content
```

Expected:

```json
browser.extract_text
```

---

## BR-013 WhatsApp Web Regression

```text
Open WhatsApp Web and locate message composer
```

Expected:

```json
browser.find_element
```

Verify:

Adapters unchanged.

---

# P5.4 AUTOMATION LAYER TESTS

---

# Terminal

## AU-001 Open Terminal

```text
Open Windows Terminal
```

Expected:

```json
automation.open_terminal
```

---

## AU-002 Execute Safe Command

```text
Run node version command in terminal
```

Expected:

```json
automation.run_command
```

---

## AU-003 Check NPM Version

```text
Run npm version command
```

Expected:

```json
automation.run_command
```

---

## AU-004 Run Project Command

```text
Run npm install check inside Ripple project
```

Expected:

```json
automation.run_command
```

---

# Project Automation

## AU-005 Open Project

```text
Open my Ripple backend project
```

Expected:

```json
automation.open_project
```

Flow:

```text
entityResolver

↓

filesystem.search

↓

project detection

↓

desktop.launch_app
```

Verify:

No Cursor hardcode.

---

## AU-006 Find Code

```text
Find authentication logic inside my backend project
```

Expected:

```json
automation.find_code
```

Uses:

```text
ripgrep
filesystem.search
```

---

## AU-007 Git Status

```text
Show git status of my current project
```

Expected:

```json
automation.git_operation
```

---

## AU-008 Git Diff

```text
Show my current code changes
```

Expected:

```json
automation.git_operation
```

---

## AU-009 Run Tests

```text
Run tests for my current project
```

Expected:

```json
automation.run_tests
```

Confirmation:

```text
Required
```

---

## AU-010 Run Build Script

```text
Run the build script for my project
```

Expected:

```json
automation.run_script
```

---

# Full System E2E Tests

---

# E2E-001 Developer Assistant Flow

Command:

```text
Open Horizon backend project, inspect authentication files, and explain possible issues
```

Expected:

```text
filesystem.search

filesystem.read_file

automation.open_project

ai later
```

---

# E2E-002 Code Fix Flow

Command:

```text
Open Horizon backend, find login issue, update the file, and run tests
```

Expected:

```text
filesystem.search

automation.open_project

filesystem.patch_file

confirmation

automation.run_tests

confirmation
```

---

# E2E-003 Browser Research Flow

Command:

```text
Search the web for Ripple desktop automation architecture and summarize the results
```

Expected:

```text
browser.open_url

browser.type

browser.extract_text
```

---

# E2E-004 File Intelligence Flow

Command:

```text
Find my resume, read it, and tell me my previous projects
```

Expected:

```text
filesystem.search

filesystem.read_file
```

---

# E2E-005 Jarvis Workflow Simulation

Command:

```text
Open my development project, analyze the structure, find problems, and prepare a development plan
```

Expected:

```text
filesystem tools

automation.open_project

AI planning later
```

---

# PASS CRITERIA

## P5.1

✅ Files found
✅ Files read
✅ Files created safely
✅ Patch creates undo
✅ No filesystem stealing browser commands

---

## P5.2

✅ Cursor typing works
✅ Notepad typing works
✅ WhatsApp typing works
✅ Hotkeys separate from keys
✅ Active window metadata returned

---

## P5.3

✅ Real Chrome profile used
✅ Extension preferred
✅ No CDP default
✅ Browser tools generic
✅ Existing adapters unaffected

---

## P5.4

✅ Terminal works
✅ Commands require safety
✅ Git operations controlled
✅ Project resolver works
✅ No IDE hardcoding

---

**Total Manual Voice Commands: 70**

This is the production QA checklist to run before marking **P8.5 Phase 5.1–5.4 stable.**
