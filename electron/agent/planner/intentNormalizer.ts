import { normalizeDesktopVoiceCommand } from "../parseDesktopInput.js";

/** P8.5b — collapse phrasing before L0 / GPT. Reuses existing i18n normalizers. */
export function normalizeIntent(command: string): string {
  return normalizeDesktopVoiceCommand(command.trim());
}
