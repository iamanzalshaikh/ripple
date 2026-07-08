export type ForegroundWindow = {
  hwnd: number;
  processName: string;
  windowTitle: string;
};

export type VisibleWindow = ForegroundWindow & {
  className: string;
};

export type A11yFocusedElement = {
  name: string;
  controlType: string;
  automationId: string;
  className: string;
  /** UIA ValuePattern / edit text when available. */
  value?: string;
};

export type A11yNodeSnapshot = {
  depth: number;
  name: string;
  controlType: string;
  automationId: string;
  className: string;
  value: string;
  hasKeyboardFocus: boolean;
  enabled: boolean;
};

export type InsertTextA11yDiagnostics = {
  windowTitle: string;
  processName: string;
  hwnd: number;
  focused: A11yNodeSnapshot | null;
  ancestorChain: A11yNodeSnapshot[];
  editableElements: A11yNodeSnapshot[];
};

export type ScreenshotOcrResult = {
  text: string;
  width: number;
  height: number;
  lineCount: number;
};

export type NativeCapabilities = {
  platform: NodeJS.Platform;
  win32Bridge: boolean;
  globalHotkeys: boolean;
  sendInput: boolean;
  accessibility: boolean;
  ocr?: boolean;
  sidecarConnected?: boolean;
  sidecarProtocol?: number;
  sidecarVersion?: string;
};

export type Win32Action =
  | "getForeground"
  | "focusHwnd"
  | "closeHwnd"
  | "minimizeAll"
  | "enumWindows"
  | "sendKeys"
  | "runSequence"
  | "getFocusedA11y"
  | "getScreenMetrics"
  | "getWindowAtPoint"
  | "getCursorPosition"
  | "mouseMove"
  | "mouseClick"
  | "mouseScroll"
  | "clickUiaInWindow";
