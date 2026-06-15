/** Electron-only automation steps (not sent to / acknowledged by backend API types). */
export const LOCAL_ACTION_TYPES = [
  "WAIT_FOR_WINDOW",
  "SEARCH_CONTACT",
  "FOCUS_CHAT_INPUT",
  "PRESS_ENTER",
  "USE_CLIPBOARD_TEXT",
  "OPEN_FOLDER",
  "OPEN_FILE",
  "LAUNCH_APP",
  "FOCUS_APP",
  "CLOSE_APP",
  "MINIMIZE_ALL",
  "SYSTEM_ACTION",
  "RECALL_MEMORY",
  "OPEN_ALIAS",
  "REMEMBER_ALIAS",
  "LIST_ALIASES",
  "REMOVE_ALIAS",
  "CREATE_FOLDER",
  "CREATE_FILE",
  "RENAME_FILE",
  "MOVE_FILE",
  "DELETE_FILE",
  "OPEN_WORKSPACE",
  "REMEMBER_WORKSPACE",
  "RUN_WORKFLOW",
  "REMEMBER_WORKFLOW",
  "LIST_WORKFLOWS",
  "REMOVE_WORKFLOW",
] as const;

export type LocalActionType = (typeof LOCAL_ACTION_TYPES)[number];

export interface LocalAction {
  type: LocalActionType;
  data?: Record<string, unknown>;
}

export type WorkflowStep =
  | { kind: "backend"; action: import("./types.js").RippleAction }
  | { kind: "local"; action: LocalAction };
