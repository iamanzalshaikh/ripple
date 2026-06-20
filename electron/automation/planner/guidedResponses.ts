/**
 * Golden rule (§1) — every non-execute outcome must guide the user.
 */

const EXAMPLES = [
  '"Download kholo" or "Open Downloads"',
  '"Create folder in downloads, name myproject"',
  '"Mera resume kholo" or "Open my resume"',
  '"VS Code kholo" or "Open Chrome"',
] as const;

export function guidedExamples(): string {
  return EXAMPLES.map((e) => `• ${e}`).join("\n");
}

/** Outcome 4 — explain why not found + what to try. */
export function guidedNotFound(command: string, detail?: string): string {
  const preview = command.trim().slice(0, 60);
  const prefix = detail
    ? `${detail} `
    : `I couldn't match "${preview}" to a desktop action on your PC. `;
  return `${prefix}Try saying:\n${guidedExamples()}`;
}

/** When OpenAI / auth is unavailable (online-first). */
export function guidedApiUnavailable(): string {
  return (
    "Full voice understanding needs OpenAI — sign in and set OPENAI_API_KEY on ripple-backend. " +
    `Until then, try a direct command:\n${guidedExamples()}`
  );
}

/** When GPT returned a plan we could not map to a local tool. */
export function guidedGptMapMiss(command: string): string {
  return guidedNotFound(
    command,
    "I understood part of that but couldn't turn it into a safe desktop action. ",
  );
}

/** P1 — create/move without a location slot. */
export function guidedMissingParent(
  op: "folder" | "file" | "move" | "delete",
): string {
  const examples: Record<string, string> = {
    folder: '"create folder in downloads named myproject"',
    file: '"create file in documents named notes.txt"',
    move: '"move Invoice.pdf from downloads to desktop"',
    delete: '"delete temp.txt from downloads"',
  };
  return (
    `Which location — Downloads, Documents, or Desktop? ` +
    `Try: ${examples[op]}`
  );
}
