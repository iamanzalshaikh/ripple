import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getWorkspacesFilePath } from "../../config/ripplePaths.js";
import { resolveAlias } from "./aliasRegistry.js";

export interface WorkspaceEntry {
  id: string;
  aliases: string[];
  url: string;
}

export const BUILTIN_WORKSPACES: WorkspaceEntry[] = [
  {
    id: "github",
    aliases: ["github", "git hub"],
    url: "https://github.com",
  },
  {
    id: "render",
    aliases: ["render"],
    url: "https://dashboard.render.com",
  },
  {
    id: "vercel",
    aliases: ["vercel"],
    url: "https://vercel.com/dashboard",
  },
  {
    id: "jira",
    aliases: ["jira"],
    url: "https://www.atlassian.com/software/jira",
  },
  {
    id: "chatgpt",
    aliases: ["chatgpt", "chat gpt", "openai"],
    url: "https://chat.openai.com",
  },
  {
    id: "notion",
    aliases: ["notion"],
    url: "https://www.notion.so",
  },
  {
    id: "youtube",
    aliases: ["youtube"],
    url: "https://www.youtube.com",
  },
  {
    id: "slack",
    aliases: ["slack"],
    url: "https://slack.com",
  },
  {
    id: "gmail",
    aliases: ["gmail", "google mail"],
    url: "https://mail.google.com",
  },
  {
    id: "linkedin",
    aliases: ["linkedin"],
    url: "https://www.linkedin.com",
  },
];

interface WorkspaceStore {
  workspaces: Record<string, { url: string; aliases?: string[] }>;
}

let cache: WorkspaceEntry[] | null = null;

function loadUserOverrides(): WorkspaceStore {
  const file = getWorkspacesFilePath();
  if (!existsSync(file)) return { workspaces: {} };

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as WorkspaceStore;
    return parsed?.workspaces ? parsed : { workspaces: {} };
  } catch {
    return { workspaces: {} };
  }
}

function buildRegistry(): WorkspaceEntry[] {
  const user = loadUserOverrides();
  const byId = new Map<string, WorkspaceEntry>();

  for (const ws of BUILTIN_WORKSPACES) {
    byId.set(ws.id, { ...ws });
  }

  for (const [id, entry] of Object.entries(user.workspaces)) {
    const key = id.trim().toLowerCase();
    byId.set(key, {
      id: key,
      aliases: entry.aliases?.length
        ? entry.aliases.map((a) => a.toLowerCase())
        : [key],
      url: entry.url,
    });
  }

  return Array.from(byId.values());
}

export function getAllWorkspaces(): WorkspaceEntry[] {
  if (!cache) cache = buildRegistry();
  return cache;
}

export function invalidateWorkspaceCache(): void {
  cache = null;
}

export function saveUserWorkspace(
  id: string,
  url: string,
  aliases?: string[],
): void {
  const store = loadUserOverrides();
  const key = id.trim().toLowerCase();
  store.workspaces[key] = {
    url,
    aliases: aliases?.length ? aliases : [key],
  };
  writeFileSync(getWorkspacesFilePath(), JSON.stringify(store, null, 2), "utf8");
  invalidateWorkspaceCache();
}

const ALIAS_INDEX = (): { alias: string; entry: WorkspaceEntry }[] =>
  getAllWorkspaces()
    .flatMap((entry) =>
      entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry })),
    )
    .sort((a, b) => b.alias.length - a.alias.length);

export function resolveWorkspace(spoken: string): WorkspaceEntry | null {
  const raw = spoken.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  const alias = resolveAlias(raw);
  if (alias?.type === "workspace" && /^https?:\/\//i.test(alias.path)) {
    return {
      id: alias.name,
      aliases: [alias.name],
      url: alias.path,
    };
  }

  const candidates = [raw];
  if (raw.startsWith("my ")) candidates.push(raw.slice(3));

  for (const { alias: key, entry } of ALIAS_INDEX()) {
    for (const candidate of candidates) {
      if (candidate === key || candidate.endsWith(` ${key}`)) {
        return entry;
      }
    }
  }

  return null;
}

export function findWorkspaceById(id: string): WorkspaceEntry | undefined {
  return getAllWorkspaces().find((w) => w.id === id);
}
