import {
  registerNativeHotkeys,
  unregisterNativeHotkeys,
} from "../native/hotkeyRegistry.js";

export function registerGlobalShortcuts(): void {
  registerNativeHotkeys();
}

export function unregisterGlobalShortcuts(): void {
  unregisterNativeHotkeys();
}
