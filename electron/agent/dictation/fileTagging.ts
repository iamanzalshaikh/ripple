import { basename } from "path";
import { searchIndexByName } from "../../storage/fileIndex.js";
import {
  findWorkspaceBasename,
  getOpenFileBasename,
  isCursorOrWindsurf,
  listWorkspaceSourceFiles,
} from "./ideContext.js";

const FILE_TAG_TRIGGERS = /^(?:at|tag|tagged|@)$/i;

const SPOKEN_EXTENSIONS: Record<string, string> = {
  py: ".py",
  ts: ".ts",
  tsx: ".tsx",
  js: ".js",
  jsx: ".jsx",
  json: ".json",
  md: ".md",
  css: ".css",
  html: ".html",
  rs: ".rs",
  go: ".go",
  java: ".java",
  cpp: ".cpp",
  c: ".c",
  env: ".env",
  txt: ".txt",
  yaml: ".yaml",
  yml: ".yml",
  vue: ".vue",
  svelte: ".svelte",
};

function trimFilenamePhrase(spoken: string): string {
  const stop = new Set([
    "the",
    "a",
    "an",
    "in",
    "on",
    "at",
    "to",
    "for",
    "and",
    "or",
    "fix",
    "bug",
    "check",
    "look",
    "please",
    "open",
    "file",
    "use",
    "with",
    "into",
    "from",
  ]);
  const words = spoken.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return spoken.trim();
  let start = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    if (stop.has(words[i]!.toLowerCase())) {
      start = i + 1;
      break;
    }
  }
  const slice = words.slice(start);
  return (slice.length ? slice : words.slice(-4)).join(" ");
}

function spokenBaseVariants(spoken: string): string[] {
  const tokens = spoken
    .trim()
    .split(/\s+/)
    .filter((t) => t && !FILE_TAG_TRIGGERS.test(t));
  if (!tokens.length) return [];

  const lower = tokens.map((t) => t.toLowerCase());
  const variants = new Set<string>();
  variants.add(lower.join(""));
  variants.add(lower.join("_"));
  variants.add(lower.join("-"));
  variants.add(
    lower[0]! +
      lower
        .slice(1)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(""),
  );
  if (tokens.length === 1) variants.add(tokens[0]!);
  return [...variants];
}

function catalogBasenames(processName?: string | null): string[] {
  const names = new Set<string>();
  const open = getOpenFileBasename(processName);
  if (open) names.add(open);
  for (const file of listWorkspaceSourceFiles(processName)) {
    names.add(file.basename);
  }
  return [...names];
}

function matchCatalog(
  spoken: string,
  extension: string | null,
  catalog: string[],
): string | null {
  const variants = spokenBaseVariants(spoken);
  for (const file of catalog) {
    const lower = file.toLowerCase();
    const stem = lower.replace(/\.[^.]+$/, "");
    for (const variant of variants) {
      const v = variant.toLowerCase();
      if (extension) {
        if (lower === `${v}${extension.toLowerCase()}`) return file;
      } else if (stem === v || lower === v) {
        return file;
      }
    }
  }
  return null;
}

function resolveFilename(
  spoken: string,
  extension: string | undefined,
  processName?: string | null,
): string | null {
  const ext = extension
    ? extension.startsWith(".")
      ? extension
      : `.${extension}`
    : null;
  const catalog = catalogBasenames(processName);
  const fromWorkspace = matchCatalog(spoken, ext, catalog);
  if (fromWorkspace) return fromWorkspace;

  for (const base of spokenBaseVariants(spoken)) {
    if (ext) {
      const fname = `${base}${ext}`;
      const hits = searchIndexByName(fname, true);
      if (hits.length) return basename(hits[0]!);
    }
    const hits = searchIndexByName(base, true);
    for (const hit of hits) {
      const fn = basename(hit);
      const fnBase = fn.replace(/\.[^.]+$/, "");
      if (fnBase.toLowerCase() === base.toLowerCase()) return fn;
    }
  }
  return null;
}

export type FileTaggingResult = {
  text: string;
  tags: string[];
};

/**
 * Wispr-style @file tagging for Cursor/Windsurf dictation.
 * Matches any file in the open project, not only the current tab.
 * Text-only — does not touch insert or focus.
 */
export function applyFileTagging(
  text: string,
  processName?: string | null,
): FileTaggingResult {
  if (!text.trim() || !isCursorOrWindsurf(processName)) {
    return { text, tags: [] };
  }

  const tags: string[] = [];
  let out = text;

  // "authCheck dot ts" / "index dot tsx"
  out = out.replace(
    /\b([A-Za-z0-9][\w-]*(?:\s+[A-Za-z0-9][\w-]*){0,4})\s+dot\s+(py|ts|tsx|js|jsx|json|md|css|html|rs|go|java|cpp|c|env|txt|yaml|yml|vue|svelte)\b/gi,
    (match, spoken, extKey) => {
      const phrase = trimFilenamePhrase(spoken as string);
      const ext = SPOKEN_EXTENSIONS[(extKey as string).toLowerCase()];
      if (!ext || !phrase) return match;
      const resolved = resolveFilename(phrase, ext, processName);
      if (!resolved) return match;
      const tag = `@${resolved}`;
      if (!tags.includes(tag)) tags.push(tag);
      return tag;
    },
  );

  // Trigger word: "at main", "tag myScript"
  out = out.replace(
    /\b(?:at|tag|tagged|@)\s+([A-Za-z0-9][\w-]*(?:\s+[A-Za-z0-9][\w-]*){0,4})(?:\s+dot\s+(py|ts|tsx|js|jsx|json|md|css|html|rs|go|java|cpp|c|env|txt|yaml|yml|vue|svelte))?\b/gi,
    (match, spoken, extKey) => {
      const phrase = trimFilenamePhrase(spoken as string);
      const ext = extKey
        ? SPOKEN_EXTENSIONS[(extKey as string).toLowerCase()]?.slice(1)
        : undefined;
      const resolved = resolveFilename(phrase, ext, processName);
      if (!resolved) return match;
      const tag = `@${resolved}`;
      if (!tags.includes(tag)) tags.push(tag);
      return tag;
    },
  );

  // Literal filename already in speech: "fix overlay.ts" / "check flowbar.tsx"
  out = out.replace(
    /\b([A-Za-z0-9][\w-]*\.[A-Za-z0-9]{1,8})\b/g,
    (match, fname) => {
      if (match.startsWith("@")) return match;
      const canonical =
        findWorkspaceBasename(fname as string, processName) ??
        resolveFilename(
          (fname as string).replace(/\.[^.]+$/, ""),
          (fname as string).includes(".")
            ? `.${(fname as string).split(".").pop()}`
            : undefined,
          processName,
        );
      if (!canonical) return match;
      const tag = `@${canonical}`;
      if (!tags.includes(tag)) tags.push(tag);
      return tag;
    },
  );

  out = out.replace(/@+/g, "@");

  return { text: out, tags };
}
