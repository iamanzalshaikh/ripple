import { existsSync, readFileSync } from "node:fs";
import { getContactsFilePath } from "../../config/ripplePaths.js";

export { getContactsFilePath } from "../../config/ripplePaths.js";

/** Optional per-user overrides — not the main contact source. */
export function loadUserContactOverrides(): string[] {
  const fromEnv = process.env.RIPPLE_CONTACTS?.split(",").map((s) => s.trim());
  if (fromEnv?.length) return fromEnv.filter(Boolean);

  const file = getContactsFilePath();
  if (!existsSync(file)) return [];

  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      contacts?: string[];
    };
    return Array.isArray(raw.contacts) ? raw.contacts : [];
  } catch {
    return [];
  }
}
