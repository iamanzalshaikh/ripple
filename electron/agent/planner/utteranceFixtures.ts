/** P8.5 §10 — regression fixtures: same intent, many phrasings → same tool. */

export type UtteranceFixture = {
  id: string;
  utterances: string[];
  expectedTool: string;
  expectedText?: string;
  expectedStepCount?: number;
  worldOverrides?: {
    clipboardHasText?: boolean;
    calculatorFocused?: boolean;
  };
};

export const P85_UTTERANCE_FIXTURES: UtteranceFixture[] = [
  {
    id: "type_text_hello",
    utterances: [
      "can you write hello",
      "write hello",
      "put hello there",
      "type hello",
      "say hello",
      "enter hello",
      "likh do hello",
      "likho hello",
      "daal do hello",
      "insert hello",
      "please type hello",
      "can you please write hello",
      "write down hello",
      "put hello in this window",
      "type karo hello",
    ],
    expectedTool: "desktop.type_text",
    expectedText: "hello",
  },
  {
    id: "type_text_sentence",
    utterances: [
      "write hello world",
      "type hello world",
      "say hello world",
      "put hello world here",
    ],
    expectedTool: "desktop.type_text",
    expectedText: "hello world",
  },
  {
    id: "select_all_copy",
    utterances: ["select all and copy", "select all copy"],
    expectedTool: "desktop.press_keys",
  },
  {
    id: "select_all_paste",
    utterances: [
      "select all and paste here",
      "select all and paste",
      "highlight all and paste here",
      "select everything and paste it",
      "select all copy and paste here",
      "copy and paste here",
      "cut and paste here",
    ],
    expectedTool: "desktop.press_keys",
    worldOverrides: { clipboardHasText: true },
  },
  {
    id: "copy_selection",
    utterances: ["copy", "copy this", "copy that"],
    expectedTool: "desktop.copy",
  },
  {
    id: "select_all",
    utterances: ["select all", "select everything", "highlight all"],
    expectedTool: "desktop.select_all",
  },
  {
    id: "paste_clipboard",
    utterances: [
      "paste this text here",
      "paste here",
      "paste the text you copied",
      "paste clipboard",
      "paste copied text",
      "paste what i copied",
    ],
    expectedTool: "desktop.paste",
    worldOverrides: { clipboardHasText: true },
  },
  {
    id: "open_downloads",
    utterances: [
      "open downloads",
      "Open Downloads",
      "open my downloads",
      "show downloads",
      "go to downloads",
      "downloads kholo",
      "download folder open karo",
    ],
    expectedTool: "filesystem.open",
  },
  {
    id: "open_documents",
    utterances: [
      "open documents",
      "open my documents",
      "show documents folder",
      "documents kholo",
    ],
    expectedTool: "filesystem.open",
  },
  {
    id: "open_desktop_folder",
    utterances: ["open desktop", "show desktop folder", "desktop kholo"],
    expectedTool: "filesystem.open",
  },
  {
    id: "open_notepad",
    utterances: [
      "open notepad",
      "launch notepad",
      "start notepad",
      "notepad kholo",
      "open Notepad",
    ],
    expectedTool: "desktop.launch_app",
  },
  {
    id: "open_chrome",
    utterances: [
      "open chrome",
      "launch chrome",
      "start google chrome",
      "chrome kholo",
    ],
    expectedTool: "desktop.launch_app",
  },
  {
    id: "editor_clear_text",
    utterances: [
      "delete all the text",
      "delete all text",
      "clear all the text",
      "remove all the text",
      "clear everything",
    ],
    expectedTool: "desktop.press_keys",
  },
  {
    id: "cursor_move",
    utterances: [
      "move my cursor down",
      "move my cursor up",
      "move my cursor left 5",
      "move my mouse cursor down",
      "move cursor right 3",
      "move my cursor to the end",
      "cursor down",
    ],
    expectedTool: "desktop.press_keys",
  },
  {
    id: "editor_clear_and_write",
    utterances: [
      "delete all the text and write ripple long command text work",
      "clear all text and type hello world",
    ],
    expectedTool: "desktop.type_text",
  },
  {
    id: "compose_defer",
    utterances: [
      "Can you write a professional email",
      "compose a professional email",
      "draft an email",
      "draft me an email",
      "write a professional message",
      "compose a letter",
      "draft a reply",
    ],
    expectedTool: "__defer__",
  },
  {
    id: "ambiguous_send",
    utterances: [
      "Send this to Ahmed",
      "share this with Ahmed",
      "send this to Ali",
      "share it with Sara",
    ],
    expectedTool: "__clarify__",
  },
  {
    id: "calculator_math",
    utterances: ["25 plus 25", "10 times 5", "100 divided by 4"],
    expectedTool: "desktop.type_text",
    worldOverrides: { calculatorFocused: true },
  },
  {
    id: "mouse_scroll_down",
    utterances: ["scroll down", "page down"],
    expectedTool: "desktop.press_keys",
  },
  {
    id: "mouse_scroll_up",
    utterances: ["scroll up", "page up"],
    expectedTool: "desktop.press_keys",
  },
  {
    id: "compound_open_type",
    utterances: [
      "Open Notepad and type hello world",
      "launch notepad and write hello",
      "open notepad then type hello",
    ],
    expectedTool: "desktop.launch_app",
    expectedStepCount: 2,
  },
  {
    id: "compound_open_folder",
    utterances: [
      "open chrome and open downloads",
      "launch chrome and open documents",
    ],
    expectedTool: "desktop.launch_app",
    expectedStepCount: 2,
  },
  {
    id: "open_calculator",
    utterances: ["open calculator", "launch calculator", "calculator kholo"],
    expectedTool: "desktop.launch_app",
  },
  {
    id: "open_vscode",
    utterances: ["open vscode", "open vs code", "launch visual studio code"],
    expectedTool: "desktop.launch_app",
  },
  {
    id: "compose_with_body",
    utterances: [
      "write a professional email: Dear Sir, I am writing to apply",
      "type this exactly: hello world",
    ],
    expectedTool: "desktop.type_text",
  },
  {
    id: "double_click_center",
    utterances: ["double click", "double click here"],
    expectedTool: "desktop.mouse_click",
  },
  {
    id: "move_mouse",
    utterances: ["move mouse down", "move mouse up"],
    expectedTool: "desktop.mouse_move",
  },
  {
    id: "active_window",
    utterances: [
      "what window is active",
      "which app is open",
      "tell me the active window",
      "current application",
    ],
    expectedTool: "desktop.get_active_window",
  },
  {
    id: "filesystem_search",
    utterances: [
      "find horizon backend",
      "search for horizon backend",
      "find my tax pdf",
      "look for package.json",
    ],
    expectedTool: "filesystem.search",
  },
  {
    id: "filesystem_read",
    utterances: [
      "read package.json",
      "read package.json in downloads",
      "show me package.json",
    ],
    expectedTool: "filesystem.read_file",
  },
  {
    id: "filesystem_list",
    utterances: [
      "list files in downloads",
      "what's in my documents",
      "show files in desktop",
    ],
    expectedTool: "filesystem.list_directory",
  },
  {
    id: "create_file_in_cursor",
    utterances: [
      "create a new file server.js in cursor",
      "create file api.ts in cursor",
      "create new file notes.txt in cursor",
    ],
    expectedTool: "filesystem.write_file",
    expectedStepCount: 2,
  },
  {
    id: "paste_reject_empty_clipboard",
    utterances: ["paste here"],
    expectedTool: "__defer__",
  },
];
