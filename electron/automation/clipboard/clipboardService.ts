import { clipboard } from "electron";
import { getLastVoiceCommand } from "../../state/lastCommand.js";

export function readClipboardText(): string {
  return clipboard.readText().trim();
}

export function writeClipboardText(text: string): void {
  clipboard.writeText(text);
}

/** True when voice command references copied / clipboard content. */
export function commandWantsClipboard(): boolean {
  const cmd = getLastVoiceCommand()?.toLowerCase() ?? "";
  return (
    /\bclipboard\b/.test(cmd) ||
    /\bcopied\b/.test(cmd) ||
    /\bwhat i copy\b/.test(cmd) ||
    /\bpaste (?:the |my )?copy/.test(cmd)
  );
}

export function resolveTextWithClipboard(generated: string): string {
  if (!commandWantsClipboard()) return generated;
  const clip = readClipboardText();
  if (clip.length > 0) {
    console.info(`[ripple-desktop] using clipboard text (${clip.length} chars)`);
    return clip;
  }
  return generated;
}
