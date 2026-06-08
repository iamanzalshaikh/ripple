/** Backend / LLM meta text that must not be pasted into Notion. */
export function isAiNotionFillerBody(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return (
    /unable to access your clipboard/i.test(t) ||
    /please paste the content you want/i.test(t) ||
    /i(?:'m| am) unable to access/i.test(t) ||
    /cannot access your clipboard/i.test(t) ||
    /as an ai/i.test(t) ||
    /i don't have access to your clipboard/i.test(t)
  );
}
