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

export type NativeCapabilities = {
  platform: NodeJS.Platform;
  win32Bridge: boolean;
  globalHotkeys: boolean;
  sendInput: boolean;
  accessibility: boolean;
};

export type Win32Action =
  | "getForeground"
  | "focusHwnd"
  | "closeHwnd"
  | "minimizeAll"
  | "enumWindows"
  | "sendKeys"
  | "runSequence"
  | "getFocusedA11y";
