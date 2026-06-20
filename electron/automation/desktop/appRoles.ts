/** P5.5 — map vague spoken roles to app id keywords. */
export const APP_ROLE_HINTS: Record<string, string[]> = {
  "my design app": ["figma", "photoshop", "paint", "canva", "illustrator"],
  "my browser": ["chrome", "firefox", "edge", "brave", "opera"],
  "my editor": ["vscode", "cursor", "notepad", "sublime", "notepad++"],
  "my terminal": ["terminal", "wt", "powershell", "cmd", "windowsterminal"],
};

export function parseAppRolePhrase(spoken: string): string | null {
  const key = spoken.trim().toLowerCase().replace(/\s+/g, " ");
  if (APP_ROLE_HINTS[key]) return key;

  const myRole = key.match(/^my\s+(.+?)\s+app$/);
  if (myRole?.[1]) {
    const candidate = `my ${myRole[1]} app`;
    if (APP_ROLE_HINTS[candidate]) return candidate;
  }

  if (key === "my browser" || key === "browser") return "my browser";
  if (key === "my editor" || key === "editor") return "my editor";
  if (key === "my terminal" || key === "terminal") return "my terminal";

  return null;
}

export function appMatchesRole(appId: string, roleKey: string): boolean {
  const hints = APP_ROLE_HINTS[roleKey];
  if (!hints) return false;
  const id = appId.toLowerCase();
  return hints.some((h) => id.includes(h) || h.includes(id));
}
