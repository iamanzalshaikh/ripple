/** Electron-only automation steps (not sent to / acknowledged by backend API types). */
export const LOCAL_ACTION_TYPES = [
  "WAIT_FOR_WINDOW",
  "SEARCH_CONTACT",
  "FOCUS_CHAT_INPUT",
  "PRESS_ENTER",
  "USE_CLIPBOARD_TEXT",
  "OPEN_FOLDER",
  "OPEN_FILE",
] as const;

export type LocalActionType = (typeof LOCAL_ACTION_TYPES)[number];

export interface LocalAction {
  type: LocalActionType;
  data?: Record<string, unknown>;
}

export type WorkflowStep =
  | { kind: "backend"; action: import("./types.js").RippleAction }
  | { kind: "local"; action: LocalAction };
