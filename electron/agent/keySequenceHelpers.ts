import { isClassicTextEditorProcess } from "./editorFocus.js";

export type KeyStep = { type: "keys"; value: string; delayMs?: number };

export function isPasteKeys(keys?: string): boolean {
  return keys?.trim().toLowerCase() === "^v";
}

export function isCopySequence(steps?: KeyStep[]): boolean {
  if (!steps?.length) return false;
  const values = steps.map((s) => s.value.trim().toLowerCase());
  return values.includes("^a") && values.includes("^c");
}

export function isCutSequence(steps?: KeyStep[]): boolean {
  if (!steps?.length) return false;
  const values = steps.map((s) => s.value.trim().toLowerCase());
  return values.includes("^a") && values.includes("^x");
}

export function isClearTextSequence(steps?: KeyStep[]): boolean {
  if (!steps?.length) return false;
  const values = steps.map((s) => s.value.trim().toUpperCase());
  return values.includes("^A") && values.some((v) => v.includes("BACKSPACE"));
}

export function sequenceDelayMs(processName?: string): number {
  return processName && isClassicTextEditorProcess(processName) ? 220 : 160;
}

const NAV_KEY_RE = /^\{(UP|DOWN|LEFT|RIGHT|HOME|END|PGUP|PGDN)\}$/i;

export function isNavigationKeys(keys?: string): boolean {
  if (!keys?.trim()) return false;
  return NAV_KEY_RE.test(keys.trim());
}

export function isNavigationSequence(steps?: KeyStep[]): boolean {
  if (!steps?.length) return false;
  return steps.every((s) => isNavigationKeys(s.value));
}
