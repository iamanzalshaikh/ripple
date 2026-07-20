/** User is editing / rephrasing existing text — never open a new app window. */
export function isEditOrRephraseCommand(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (!c) return false;

  if (
    /(?:بہتر|بہترین|جذباتی|اعتماد|واضح|تبدیل|دوبارہ|لکھ|ضرورت|ای\s*میل|طریقہ)/u.test(
      command,
    )
  ) {
    return true;
  }

  // A long dictated message can legitimately contain or end in a tone word
  // ("...make these techs more confident and professional") without being an
  // instruction to Ripple at all — it's just the content of the message. The
  // weak/unanchored patterns below are only trustworthy for short, clearly
  // instruction-shaped utterances; gate them so they can't swallow real
  // dictation just because it happens to mention a tone word.
  const wordCount = c.split(/\s+/).filter(Boolean).length;
  const isShortUtterance = wordCount <= 10;

  return (
    /\b(rephrase|rewrite|reword|revise|edit|modify|adjust|improve|fix|refresh)\b/i.test(c) ||
    /\b(behtar|behtareen|jazbati|wazeh|dubara|tabdeel|zarurat)\b/i.test(c) ||
    (isShortUtterance &&
      /\bmake\s+(it|this|that)(\s+\w+){0,3}\s+(more\s+)?/i.test(c)) ||
    (isShortUtterance &&
      /\bmake\s+(?:this|that)\s+text\s+(more\s+)?(emotional|confident|sad|angry|mad|formal|casual|professional|friendly|short|long|warm|empathetic|playful|supportive|enthusiastic|sincere|caring|loving|funny|polite|gentle|romantic|excited|respectful)\b/i.test(c)) ||
    (isShortUtterance &&
      /\bmake\s+it\s+(more\s+)?(emotional|confident|sad|angry|mad|formal|casual|professional|friendly|short|long|warm|empathetic|playful|supportive|enthusiastic|sincere|caring|loving|funny|polite|gentle|romantic|excited|respectful)\b/i.test(c)) ||
    (isShortUtterance && /\bmake\s+it\s+like\b/i.test(c)) ||
    (isShortUtterance &&
      /\b(more|less)\s+(confident|emotional|formal|casual|professional|friendly|angry|warm|empathetic|playful|supportive|enthusiastic|sincere|caring|loving|funny|polite|gentle|romantic|excited|respectful)\b/i.test(c)) ||
    /\b(change|update)\s+(the\s+)?(tone|wording|text)\b/i.test(c) ||
    /\b(shorten|lengthen|expand|condense)\b/i.test(c) ||
    (isShortUtterance &&
      /\b(emotional|confident|sad|angry|mad|formal|casual|professional|friendly|warm|empathetic|playful|supportive|enthusiastic|sincere|caring|loving|funny|polite|gentle|romantic|excited|respectful)\s*$/i.test(c))
  );
}

const HAS_EMAIL = /[a-z0-9][\w.+-]*@[\w.-]+\.[a-z]{2,}/i;
const HAS_GMAIL_SPEECH = /\b[a-z0-9][\w.+-]*\s+at\s+(?:a\s+rate\s+)?gmail/i;

/** Gmail / email compose — must not be routed to WhatsApp workflow. */
export function isGmailVoiceCommand(command: string): boolean {
  const c = command.trim().toLowerCase();
  if (!c) return false;
  if (/\b(gmail|google\s*mail)\b/i.test(c)) return true;
  if (/\bgmail\s+dot\s+com\b/i.test(c)) return true;
  if (/\b(write|send|compose|draft)\s+(a\s+)?(mail|email)\b/i.test(c)) return true;
  if (/\b(mail|email)\s+to\b/i.test(c) && (HAS_EMAIL.test(c) || HAS_GMAIL_SPEECH.test(c) || /\bat\s+gmail/i.test(c))) {
    return true;
  }
  return isNewEmailCommand(command);
}

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
