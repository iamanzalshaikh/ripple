/** Frozen P5.1–P5.4 voice QA matrix from cursor/test.md */

export type P5QaExpectKind = "execute" | "defer" | "clarify" | "blocked";

export type P5QaCase = {
  id: string;
  command: string;
  /** Tools that must appear in plan order (subsequence). */
  tools?: string[];
  /** Any one of these tool sequences is acceptable. */
  altToolSets?: string[][];
  kind?: P5QaExpectKind;
  forbid?: string[];
  minSteps?: number;
};

export const P5_QA_MATRIX: P5QaCase[] = [
  // P5.1 Filesystem
  {
    id: "FS-001",
    command: "Show me all files inside my Downloads folder",
    tools: ["filesystem.list_directory"],
  },
  {
    id: "FS-002",
    command: "Show me everything inside my Documents folder",
    tools: ["filesystem.list_directory"],
  },
  {
    id: "FS-003",
    command: "Find my resume file inside my computer",
    tools: ["filesystem.search"],
  },
  {
    id: "FS-004",
    command: "Find my Horizon backend project folder",
    tools: ["filesystem.search"],
  },
  {
    id: "FS-005",
    command: "Find all authentication related files inside Horizon backend",
    tools: ["filesystem.search"],
    altToolSets: [["automation.find_code"], ["filesystem.search"]],
  },
  {
    id: "FS-006",
    command: "Read package.json from my Horizon backend project",
    tools: ["filesystem.read_file"],
    altToolSets: [["filesystem.search", "filesystem.read_file"]],
  },
  {
    id: "FS-007",
    command: "Read auth.service.ts from my backend project",
    altToolSets: [
      ["filesystem.read_file"],
      ["filesystem.search", "filesystem.read_file"],
    ],
  },
  {
    id: "FS-008",
    command: "Show metadata of package.json in Horizon backend",
    tools: ["filesystem.get_metadata"],
    altToolSets: [["filesystem.read_file"], ["filesystem.search", "filesystem.get_metadata"]],
  },
  {
    id: "FS-009",
    command: "Create a new file called ripple-test.txt inside Documents",
    tools: ["filesystem.create_file"],
    altToolSets: [["filesystem.create"], ["filesystem.write_file"], ["desktop.type_text"]],
  },
  {
    id: "FS-010",
    command: 'Write "Ripple P8.5 filesystem testing complete" into ripple-test.txt',
    tools: ["filesystem.write_file"],
    altToolSets: [["desktop.type_text"]],
  },
  {
    id: "FS-011",
    command:
      "Update ripple-test.txt and replace filesystem testing with capability testing",
    tools: ["filesystem.patch_file"],
    kind: "clarify",
    altToolSets: [["filesystem.patch_file"]],
  },
  {
    id: "FS-012",
    command: "Move ripple-test.txt from Documents to Desktop",
    tools: ["filesystem.move_file"],
    altToolSets: [["filesystem.move"], ["filesystem.search", "filesystem.move_file"]],
  },
  {
    id: "FS-013",
    command: "Delete all files inside Documents folder",
    kind: "blocked",
    altToolSets: [["filesystem.delete"]],
  },

  // P5.2 Desktop
  { id: "DT-001", command: "Open Notepad application", tools: ["desktop.launch_app"] },
  { id: "DT-002", command: "Open Cursor editor", tools: ["desktop.launch_app"] },
  {
    id: "DT-003",
    command: "Tell me what application is currently active",
    tools: ["desktop.get_active_window"],
    altToolSets: [["desktop.get_active_window"]],
  },
  {
    id: "DT-004",
    command: "Switch focus to Cursor editor",
    tools: ["desktop.focus_window"],
    altToolSets: [["desktop.launch_app"], ["desktop.focus_window"]],
  },
  {
    id: "DT-005",
    command: "Type hello from Ripple desktop automation",
    tools: ["desktop.type_text"],
  },
  {
    id: "DT-006",
    command: "Type first line Ripple test and second line automation success",
    tools: ["desktop.type_text"],
    kind: "partial",
  },
  {
    id: "DT-007",
    command: "Type console.log Ripple automation test inside Cursor",
    tools: ["desktop.type_text"],
  },
  {
    id: "DT-008",
    command: "Press Enter to create a new line",
    altToolSets: [["desktop.press_key"], ["desktop.press_keys"]],
  },
  {
    id: "DT-009",
    command: "Move cursor three lines upward using arrow keys",
    altToolSets: [["desktop.press_key"], ["desktop.press_keys"]],
  },
  {
    id: "DT-010",
    command: "Select all text in current editor",
    altToolSets: [["desktop.hotkey"], ["desktop.select_all"], ["desktop.press_keys"]],
    kind: "defer",
  },
  {
    id: "DT-011",
    command: "Copy the selected text",
    altToolSets: [["desktop.hotkey"], ["desktop.copy"], ["desktop.press_keys"]],
    kind: "defer",
  },
  {
    id: "DT-012",
    command: "Paste copied text into the editor",
    altToolSets: [["desktop.hotkey"], ["desktop.paste"], ["desktop.press_keys"]],
    kind: "defer",
  },
  { id: "DT-013", command: "Close Notepad", tools: ["desktop.close_app"], kind: "clarify" },
  {
    id: "DT-014",
    command: "Open WhatsApp Web and type hello message in the composer",
    altToolSets: [
      ["browser.whatsapp.send"],
      ["desktop.launch_app", "desktop.type_text"],
      ["desktop.type_text"],
    ],
    kind: "partial",
    minSteps: 1,
  },

  // P5.3 Browser
  {
    id: "BR-001",
    command: "Open github.com in my browser",
    tools: ["browser.open_url"],
    altToolSets: [["filesystem.open"]],
  },
  {
    id: "BR-002",
    command: "Open React documentation website",
    altToolSets: [["browser.open_url"], ["desktop.launch_app"]],
  },
  {
    id: "BR-003",
    command: "Open YouTube in my current browser tab",
    altToolSets: [
      ["browser.open_url"],
      ["browser.open_workspace"],
      ["browser.youtube.run"],
    ],
  },
  {
    id: "BR-004",
    command: "Read visible text from the current webpage",
    tools: ["browser.extract_text"],
  },
  {
    id: "BR-005",
    command: "Open Wikipedia React page and extract the visible content",
    altToolSets: [
      ["browser.open_url", "browser.extract_text"],
      ["browser.extract_text"],
    ],
    minSteps: 1,
  },
  {
    id: "BR-006",
    command: "Find the search input box on Google",
    tools: ["browser.find_element"],
  },
  { id: "BR-007", command: "Click the Google search box", tools: ["browser.click"] },
  {
    id: "BR-008",
    command: "Type Ripple desktop automation into Google search",
    tools: ["browser.type"],
  },
  {
    id: "BR-009",
    command: "Press Enter and search Google",
    altToolSets: [
      ["desktop.press_key"],
      ["desktop.press_keys"],
      ["browser.search_workspace"],
    ],
    kind: "execute",
  },
  {
    id: "BR-010",
    command: "Scroll down the webpage by one screen",
    tools: ["browser.scroll"],
  },
  {
    id: "BR-011",
    command: "Open YouTube and search for relaxing music",
    altToolSets: [
      ["browser.youtube.run"],
      ["browser.open_url", "browser.type"],
      ["browser.open_workspace", "browser.youtube.run"],
    ],
    minSteps: 1,
  },
  {
    id: "BR-012",
    command: "Open Gmail and show the visible page content",
    altToolSets: [
      ["browser.gmail.compose"],
      ["browser.open_workspace", "browser.extract_text"],
      ["browser.extract_text"],
    ],
    minSteps: 1,
  },
  {
    id: "BR-013",
    command: "Open WhatsApp Web and locate message composer",
    altToolSets: [
      ["browser.find_element"],
      ["browser.whatsapp.send"],
      ["browser.open_workspace"],
    ],
    minSteps: 1,
  },

  // P5.4 Automation
  {
    id: "AU-001",
    command: "Open Windows Terminal",
    tools: ["automation.open_terminal"],
    altToolSets: [["desktop.launch_app"]],
  },
  {
    id: "AU-002",
    command: "Run node version command in terminal",
    tools: ["automation.run_command"],
  },
  {
    id: "AU-003",
    command: "Run npm version command",
    tools: ["automation.run_command"],
  },
  {
    id: "AU-004",
    command: "Run npm install check inside Ripple project",
    tools: ["automation.run_command"],
  },
  {
    id: "AU-005",
    command: "Open my Ripple backend project",
    tools: ["automation.open_project"],
    altToolSets: [["filesystem.search", "automation.open_project"]],
  },
  {
    id: "AU-006",
    command: "Find authentication logic inside my backend project",
    tools: ["automation.find_code"],
    altToolSets: [["filesystem.search"], ["filesystem.search", "automation.find_code"]],
  },
  {
    id: "AU-007",
    command: "Show git status of my current project",
    tools: ["automation.git_operation"],
  },
  {
    id: "AU-008",
    command: "Show my current code changes",
    tools: ["automation.git_operation"],
  },
  {
    id: "AU-009",
    command: "Run tests for my current project",
    tools: ["automation.run_tests"],
  },
  {
    id: "AU-010",
    command: "Run the build script for my project",
    tools: ["automation.run_script"],
    altToolSets: [["automation.run_command"]],
  },

  // Full E2E flows
  {
    id: "E2E-001",
    command:
      "Open Horizon backend project, inspect authentication files, and explain possible issues",
    altToolSets: [
      ["filesystem.search", "filesystem.read_file"],
      ["automation.open_project", "filesystem.read_file"],
      ["filesystem.search", "automation.open_project"],
      ["automation.open_project"],
      ["filesystem.search"],
      ["desktop.launch_app"],
    ],
    kind: "partial",
    minSteps: 1,
  },
  {
    id: "E2E-002",
    command: "Open Horizon backend, find login issue, update the file, and run tests",
    altToolSets: [
      ["automation.open_project", "filesystem.patch_file", "automation.run_tests"],
      ["filesystem.search", "filesystem.patch_file"],
      ["automation.open_project"],
      ["filesystem.search"],
      ["filesystem.open"],
    ],
    kind: "partial",
    minSteps: 1,
  },
  {
    id: "E2E-003",
    command:
      "Search the web for Ripple desktop automation architecture and summarize the results",
    altToolSets: [
      ["browser.open_url", "browser.extract_text"],
      ["browser.open_url", "browser.type"],
      ["browser.search_workspace"],
      ["filesystem.search"],
    ],
    minSteps: 1,
  },
  {
    id: "E2E-004",
    command: "Find my resume, read it, and tell me my previous projects",
    altToolSets: [["filesystem.search", "filesystem.read_file"], ["filesystem.search"]],
    minSteps: 1,
  },
  {
    id: "E2E-005",
    command:
      "Open my development project, analyze the structure, find problems, and prepare a development plan",
    altToolSets: [
      ["automation.open_project", "filesystem.list_directory"],
      ["filesystem.search", "filesystem.list_directory"],
      ["automation.open_project"],
      ["filesystem.search"],
      ["filesystem.open"],
    ],
    kind: "partial",
    minSteps: 1,
  },
];
