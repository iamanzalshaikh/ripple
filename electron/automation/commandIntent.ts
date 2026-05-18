/** User is editing / rephrasing existing text — never open a new app window. */
export function isEditOrRephraseCommand(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (!c) return false;

  return (
    /\b(rephrase|rewrite|reword|revise|edit|modify|adjust|improve|fix|refresh)\b/i.test(c) ||
    /\bmake\s+(it|this|that)(\s+\w+){0,3}\s+(more\s+)?/i.test(c) ||
    /\bmake\s+it\s+like\b/i.test(c) ||
    /\b(more|less)\s+(confident|emotional|formal|casual|professional|friendly|angry)\b/i.test(c) ||
    /\b(change|update)\s+(the\s+)?(tone|wording|text)\b/i.test(c) ||
    /\b(shorten|lengthen|expand|condense)\b/i.test(c) ||
    c === "undo" ||
    c === "revert"
  );
}

const HAS_EMAIL = /[a-z0-9][\w.+-]*@[\w.-]+\.[a-z]{2,}/i;
const HAS_GMAIL_SPEECH = /\b[a-z0-9][\w.+-]*\s+at\s+(?:a\s+rate\s+)?gmail/i;

/** Brand-new email — OK to open Gmail compose URL with To/Subject/Body. */
export function isNewEmailCommand(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (!c) return false;

  if (isEditOrRephraseCommand(c)) return false;

  const hasRecipient = HAS_EMAIL.test(c) || HAS_GMAIL_SPEECH.test(c);

  return (
    /^open\s+(gmail|google\s*mail)\s+and\s+/i.test(c) ||
    /\bwrite\s+(a\s+)?(mail|email)\b/i.test(c) ||
    /\b(send|compose)\s+(an?\s+)?(mail|email)\b/i.test(c) ||
    /\bdraft\s+(an?\s+)?(mail|email)\b/i.test(c) ||
    (/\b(mail|email)\s+to\b/i.test(c) && hasRecipient)
  );
}
