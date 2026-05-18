/** Last voice/command text — used to extract recipient email for Gmail compose. */
let lastVoiceCommand: string | null = null;
let lastCommandIntent: string | null = null;

export function setLastVoiceCommand(command: string): void {
  lastVoiceCommand = command.trim() || null;
}

export function getLastVoiceCommand(): string | null {
  return lastVoiceCommand;
}

export function setLastCommandIntent(intent: string | undefined): void {
  lastCommandIntent = intent?.trim() || null;
}

export function getLastCommandIntent(): string | null {
  return lastCommandIntent;
}

export function isEditIntent(): boolean {
  const intent = lastCommandIntent?.toLowerCase();
  return intent === "edit" || intent === "undo";
}
