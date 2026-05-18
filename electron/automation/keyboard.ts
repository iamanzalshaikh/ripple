import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delay } from "./delay.js";

const execFileAsync = promisify(execFile);

/** Escape text for PowerShell SendKeys (literal chars only). */
function escapeSendKeys(text: string): string {
  return text
    .replace(/[+^%~()[\]{}]/g, (c) => `{${c}}`)
    .replace(/\r\n/g, "{ENTER}")
    .replace(/\n/g, "{ENTER}")
    .replace(/\r/g, "{ENTER}");
}

async function runSendKeys(keys: string): Promise<void> {
  if (process.platform === "win32") {
    const escaped = keys.replace(/'/g, "''");
    await execFileAsync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
      ],
      { windowsHide: true },
    );
    return;
  }

  if (process.platform === "darwin") {
    await execFileAsync("osascript", [
      "-e",
      `tell application "System Events" to keystroke "${keys.replace(/"/g, '\\"')}"`,
    ]);
    return;
  }

  await execFileAsync("xdotool", ["type", keys]);
}

export async function sendKeyChord(chord: string): Promise<void> {
  await runSendKeys(chord);
}

export async function sendTab(count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await runSendKeys("{TAB}");
    await delay(60);
  }
}

export async function sendShiftTab(count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await runSendKeys("+{TAB}");
    await delay(60);
  }
}

export async function selectAll(): Promise<void> {
  await sendKeyChord("^a");
  await delay(50);
}

export async function pasteFromClipboard(): Promise<void> {
  if (process.platform === "win32") {
    await sendKeyChord("^v");
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to keystroke "v" using command down',
    ]);
    return;
  }
  await execFileAsync("xdotool", ["key", "ctrl+v"]);
}

/** Type short text via simulated keystrokes (best for &lt; ~300 chars). */
export async function simulateTyping(text: string): Promise<void> {
  const chunkSize = 200;
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize);
    await runSendKeys(escapeSendKeys(chunk));
    await delay(40);
  }
}
