/** Normalize spoken / STT Instagram handles (@, _, ., spaces). */
export function normalizeSpokenInstagramUsername(raw: string): string {
  let u = raw.trim();

  u = u.replace(/^@+/, "");
  u = u.replace(/\s+and\s*$/i, "");
  u = u.replace(/^underscope\s+/i, "");
  u = u.replace(/^at\s+(?:sign\s+)?/i, "");
  u = u.replace(/\bunderscore\b/gi, "_");
  u = u.replace(/\b(?:dot|period|point)\b/gi, ".");
  u = u.replace(/\s+/g, "");
  u = u.replace(/[.,;]+$/, "");

  return u.slice(0, 30);
}

export function isPlausibleInstagramHandle(username: string): boolean {
  const u = username.trim();
  if (!u || u.length < 2) return false;
  return /^@?[A-Za-z0-9][A-Za-z0-9._]{0,29}$/.test(u);
}
