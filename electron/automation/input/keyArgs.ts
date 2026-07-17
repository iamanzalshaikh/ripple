/** True when SendKeys value is a modifier chord (^a, ^+s, ^%f). */
export function isHotkeyChord(keys: string): boolean {
  const k = keys.trim();
  if (!k) return false;
  return /^[\^%+]/.test(k) || /[\^%+].*\+/.test(k);
}

/** Map P5.2 press_key / hotkey args → legacy INSERT_TEXT keys payload. */
export function keysFromDesktopKeyArgs(
  tool: string,
  args: Record<string, unknown>,
): string | null {
  if (tool === "desktop.press_key") {
    const key = typeof args.key === "string" ? args.key.trim() : "";
    return key || null;
  }
  if (tool === "desktop.hotkey") {
    const chord =
      typeof args.chord === "string"
        ? args.chord.trim()
        : typeof args.keys === "string"
          ? args.keys.trim()
          : "";
    return chord || null;
  }
  if (tool === "desktop.press_keys") {
    const keys = typeof args.keys === "string" ? args.keys.trim() : "";
    return keys || null;
  }
  return null;
}
