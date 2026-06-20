import type { VisibleWindow } from "../../native/types.js";
import { listVisibleWindowsNative } from "../../native/win32Bridge.js";

export type { VisibleWindow };

export async function listVisibleWindows(): Promise<VisibleWindow[]> {
  return listVisibleWindowsNative();
}
