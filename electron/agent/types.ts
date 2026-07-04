import type { A11yFocusedElement, ForegroundWindow } from "../native/types.js";
import type { FocusContext } from "../focus/focusContext.js";
import type { GoalState } from "./goalManager.js";

export type DesktopInputParsed =
  | { mode: "text"; text: string; replaceAll?: boolean; prefocusKeys?: string }
  | { mode: "keys"; keys: string }
  | {
      mode: "sequence";
      sequence: Array<{ value: string; delayMs?: number }>;
    }
  | {
      mode: "mouse";
      action:
        | "click"
        | "double_click"
        | "scroll_up"
        | "scroll_down"
        | "move"
        | "move_to_center";
      deltaX?: number;
      deltaY?: number;
    };

export type ObservationSnapshot = {
  foreground: ForegroundWindow | null;
  focusedA11y: A11yFocusedElement | null;
  timestamp: number;
};

export type TypingObservationResult = {
  ok: boolean;
  reason?: string;
  before: ObservationSnapshot;
  after: ObservationSnapshot;
};

export type WorldBrowserSurface =
  | "whatsapp"
  | "gmail"
  | "instagram"
  | "linkedin"
  | "youtube"
  | "notion"
  | "slack"
  | null;

export type WorldMouseState = {
  x: number;
  y: number;
  windowUnderCursor: ForegroundWindow | null;
  monitorHandle?: number;
};

export type WorldModel = {
  capturedAt: number;
  foreground: ForegroundWindow | null;
  focusedField: A11yFocusedElement | null;
  focusContext: FocusContext | null;
  mouse: WorldMouseState;
  browser: {
    surface: WorldBrowserSurface;
    tabUrl?: string;
    windowTitle?: string;
  };
  clipboard: {
    hasText: boolean;
    preview: string;
    length: number;
  };
  capabilities: {
    sidecarConnected: boolean;
    sendInput: boolean;
    uia: boolean;
    ocr: boolean;
  };
  activeGoal: GoalState | null;
};

export type UniversalToolId =
  | "desktop.type_text"
  | "desktop.press_keys"
  | "desktop.launch"
  | "desktop.open"
  | "memory.search"
  | "clarify";

export type UniversalPlanResult =
  | {
      kind: "execute";
      tool: UniversalToolId;
      confidence: number;
      payload: Record<string, unknown>;
      reason: string;
    }
  | {
      kind: "clarify";
      confidence: number;
      question: string;
      options?: string[];
      reason: string;
    }
  | {
      kind: "defer";
      reason: string;
    };
