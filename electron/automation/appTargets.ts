/** Known app names → default URLs (web apps). */
const TARGET_URLS: Record<string, string> = {
  gmail: "https://mail.google.com",
  "google mail": "https://mail.google.com",
  whatsapp: "https://web.whatsapp.com",
  slack: "https://slack.com",
  notion: "https://www.notion.so",
  linkedin: "https://www.linkedin.com",
  twitter: "https://twitter.com",
  x: "https://x.com",
  chrome: "https://www.google.com",
  browser: "https://www.google.com",
  outlook: "https://outlook.live.com",
};

export function resolveAppUrl(target?: string, url?: string): string | null {
  if (url && /^https?:\/\//i.test(url)) return url;
  if (!target) return url ?? null;
  const key = target.trim().toLowerCase();
  return TARGET_URLS[key] ?? url ?? null;
}
