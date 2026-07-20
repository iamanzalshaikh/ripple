I understand. You want a **Wave 0 production test suite** that is **fully automated through Playwright/UI voice testing**, not manual clicking.

Goal:

* Create a clean test environment automatically.
* Run every W0 trust blocker.
* Verify Ripple behavior.
* Verify filesystem/UI reality.
* No fake SUCCESS.
* If Wave 0 passes → move to Wave 1.

Below is the Notion-ready document.

---

# Ripple P8.5-P5.6 — Wave 0 Production Trust Test Plan

**Status:** ACTIVE TEST SUITE
**Purpose:** Validate OS automation foundation before adding more features.

## Wave 0 Exit Criteria

Wave 0 is PASS only when:

✅ OS commands route correctly
✅ No automation.run_command stealing OS tasks
✅ No fake SUCCESS
✅ Copy/move/create verify actual disk state
✅ Spoken paths resolve correctly
✅ Compound commands work
✅ Clarify state does not block future commands
✅ Single command executes once
✅ Execution ledger matches reality

---

# Test Environment

## Root Test Folder

Create this automatically:

```
C:\Ripple-Test
```

Inside:

```
C:\Ripple-Test
│
└── W0
    │
    ├── Source
    │   ├── Reports
    │   │   ├── Q1
    │   │   │   └── sales.txt
    │   │   ├── report1.txt
    │   │   └── report2.txt
    │   │
    │   └── Archive
    │
    ├── Destination
    │
    └── Backup
```

Final structure:

```
C:\Ripple-Test\W0\Source\Reports
```

contains:

```
Q1
 └── sales.txt

report1.txt

report2.txt
```

---

# Playwright Setup Step 0

Open Ripple.

Navigate to:

```
Ripple Desktop App
```

Wait:

```
window ready
voice available
planner available
```

Clear previous memory:

Command:

```
Clear current task context
```

Expected:

```
context cleared
```

---

# TEST 1 — Create Root Folder

## Voice Command

```
Create a folder called Ripple-Test on C drive
```

Expected Intent:

```json
{
domain:"filesystem",
action:"create_folder"
}
```

Expected Tool:

```
filesystem.create_folder
```

Verify:

Exists:

```
C:\Ripple-Test
```

Ledger:

```
SUCCESS
verification.folder_exists=true
```

---

# TEST 2 — Create W0 Folder

Command:

```
Create a folder called W0 inside Ripple-Test
```

Expected:

```
C:\Ripple-Test\W0
```

Verify:

```
folder_exists
```

---

# TEST 3 — Create Source Folder

Command:

```
Create Source folder inside W0
```

Expected:

```
C:\Ripple-Test\W0\Source
```

---

# TEST 4 — Create Reports Folder

Command:

```
Create Reports folder inside Source
```

Expected:

```
C:\Ripple-Test\W0\Source\Reports
```

---

# TEST 5 — Create Nested Folder

W0.1 nested folder test.

Command:

```
Create Q1 folder inside Reports
```

Expected:

```
Reports
 └── Q1
```

---

# TEST 6 — Create Test Files

Command:

```
Create a file called sales.txt inside Q1
```

Expected:

```
Reports
 └── Q1
      └── sales.txt
```

---

Command:

```
Create report1.txt inside Reports
```

Expected:

```
Reports
 └── report1.txt
```

---

Command:

```
Create report2.txt inside Reports
```

Expected:

```
Reports
 └── report2.txt
```

---

# TEST 7 — Spoken Path Resolution

## Purpose

No full path.

Command:

```
Find Reports folder
```

Expected:

Ripple resolves:

```
C:\Ripple-Test\W0\Source\Reports
```

NOT:

```
Desktop\.ripple\reports
```

Fail condition:

```
Unknown parent folder
Using Desktop fallback
```

---

# TEST 8 — W0.3 Copy Folder Bug Test

## Main production test

Command:

```
Copy the folder Reports to a new folder called Archive
```

Expected Intent:

```json
{
domain:"filesystem",
action:"copy",
source:"Reports",
destination:"Archive"
}
```

Expected planner:

```
filesystem.copy_folder
```

NOT:

```
automation.run_command
```

---

Expected result:

Create:

```
C:\Ripple-Test\W0\Source\Archive
```

Inside:

```
Archive
│
├── Q1
│   └── sales.txt
│
├── report1.txt
└── report2.txt
```

---

Verify:

```
Archive exists
Archive\Q1 exists
Archive\Q1\sales.txt exists
Archive\report1.txt exists
Archive\report2.txt exists
```

---

FAIL examples:

```
Desktop\Archive
```

or

```
Desktop\Reports
```

or

```
SUCCESS but folder missing
```

---

# TEST 9 — Copy Into Existing Destination

Create:

```
C:\Ripple-Test\W0\Destination
```

Command:

```
Copy Reports into Destination
```

Expected:

```
Destination
 └── Reports
      ├── Q1
      ├── report1.txt
      └── report2.txt
```

---

# TEST 10 — Verify No Desktop Collapse

Command:

```
Copy Reports to TestFolder
```

without destination existing.

Expected:

Ripple creates:

```
TestFolder
```

inside current workspace.

NOT:

```
Desktop\TestFolder
```

---

# TEST 11 — Compare Folders

Create:

```
CompareA
CompareB
```

inside:

```
C:\Ripple-Test\W0
```

Command:

```
Compare CompareA and CompareB
```

Expected:

Intent:

```
filesystem.compare_directories
```

NOT:

```
compound_unresolved
```

Result:

```
comparison report returned
```

---

# TEST 12 — Admin Routing Test

Critical FEATURE_GAPS fix.

Command:

```
Run Notepad as administrator
```

Expected:

Intent:

```json
{
domain:"admin",
action:"run_as_admin"
}
```

Tool:

```
os.run_as_admin
```

Forbidden:

```
automation.run_command
```

Verify:

Process:

```
notepad.exe
```

has:

```
Elevated = true
```

---

# TEST 13 — Automation Wall Test

Command:

```
Run delete temp files as administrator
```

Expected:

BLOCK:

```
automation.run_command rejected
```

Reason:

```
dangerous intent family
```

---

# TEST 14 — Fake SUCCESS Detection

Break test:

Command:

```
Copy MissingFolder to Archive
```

Expected:

NOT:

```
SUCCESS
```

Expected:

```
FAILED
Source not found
verification=false
```

---

# TEST 15 — Duplicate Dispatch Test

Command:

```
Copy report1.txt to Backup
```

Expected:

Exactly one execution:

Ledger:

```
command_id = one
tool_calls = one
```

Fail:

```
two command ids
two copies
```

---

# TEST 16 — Clarify Recovery Test

Command:

```
Compare these two folders
```

Expected:

Ripple asks:

```
Which folders?
```

Then:

Next command:

```
Show recent context
```

Expected:

Runs normally.

Must NOT:

merge with old compare request.

---

# TEST 17 — Execution Ledger Test

After copy:

Check:

```
.ripple/executions/
```

Must contain:

```json
{
intent:"copy",
tool:"filesystem.copy_folder",
verification:{
exists:true
},
status:"SUCCESS"
}
```

---

# TEST 18 — Undo Verification

Command:

```
Undo last copy
```

Expected:

Archive removed.

Verify:

```
Archive does not exist
```

Ledger:

```
undo SUCCESS
```

---

# TEST 19 — Clean Test Machine

Command:

```
Remove Ripple Test W0 environment
```

Expected:

Confirm required.

After confirmation:

Delete:

```
C:\Ripple-Test
```

Verify:

```
folder missing
```

---

# TEST 20 — Full Wave 0 Production Smoke

Run sequence:

```
Create Ripple-Test
Create W0
Create Reports
Create files
Copy Reports to Archive
Compare folders
Run admin command
Trigger failed command
Undo copy
```

Expected:

```
20/20 PASS
```

---

# Playwright Automation Structure

Create:

```
tests/
└── p85-p56/
    └── wave0/
        ├── setup.spec.ts
        ├── filesystem-copy.spec.ts
        ├── admin-routing.spec.ts
        ├── ledger.spec.ts
        ├── clarify-recovery.spec.ts
        └── cleanup.spec.ts
```

---

# Wave 0 Complete Means

Before moving to Wave 1:

```
filesystem.copy_folder ✅
filesystem.create_folder ✅
filesystem.compare_directories ✅
os.run_as_admin ✅
executionLedger ✅
verifyPostConditions ✅
Intent Contract ✅
Automation Wall ✅
Undo ✅
```

Then move to:

```
Wave 1:
Intent Contract + Semantic OS MVP
```

---

This is the correct way to test. Do not manually create Reports/Archive anymore. The Playwright setup should create the entire test world, run commands, inspect disk state, and destroy it after. This becomes your permanent regression suite.
