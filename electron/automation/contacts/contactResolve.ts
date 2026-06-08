import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONTACTS_FILE = join(homedir(), ".ripple", "contacts.json");

/** Optional per-user overrides — not the main contact source. */
export function loadUserContactOverrides(): string[] {
  const fromEnv = process.env.RIPPLE_CONTACTS?.split(",").map((s) => s.trim());
  if (fromEnv?.length) return fromEnv.filter(Boolean);

  if (!existsSync(CONTACTS_FILE)) return [];

  try {
    const raw = JSON.parse(readFileSync(CONTACTS_FILE, "utf8")) as {
      contacts?: string[];
    };
    return Array.isArray(raw.contacts) ? raw.contacts : [];
  } catch {
    return [];
  }
}

export function getContactsFilePath(): string {
  return CONTACTS_FILE;
}
