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
  | "mouseScroll";
