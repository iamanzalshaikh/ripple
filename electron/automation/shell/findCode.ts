import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { truncateShellOutput } from "./runCommand.js";
import { shouldIgnoreDirName } from "./projectScan.js";

const DEFAULT_MAX_RESULTS = 40;
const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cs",
  ".json",
  ".md",
]);

/** Split a spoken query into independent search terms (OR semantics). */
export function parseSearchTerms(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];

  const parts = raw.split(/\s+/).flatMap((part) => {
    if (part.includes("_")) {
      return part.split("_").filter((p) => p.length >= 2);
    }
    return [part];
  });

  const terms = new Set<string>();
  for (const part of parts) {
    const term = part.trim();
    if (term.length >= 2) terms.add(term);
  }
  return [...terms];
}

function escapeRipgrepToken(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRipgrepPattern(terms: string[]): string {
  if (terms.length === 1) return escapeRipgrepToken(terms[0]!);
  return terms.map(escapeRipgrepToken).join("|");
}

function fileMatchesAnyTerm(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function walkAndSearch(
  root: string,
  terms: string[],
  extension?: string,
  maxResults = DEFAULT_MAX_RESULTS,
): string[] {
  const hits: string[] = [];
  const stack = [root];
  const extFilter = extension?.trim().toLowerCase();

  while (stack.length > 0 && hits.length < maxResults) {
    const dir = stack.pop()!;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (hits.length >= maxResults) break;
      if (shouldIgnoreDirName(name)) continue;
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
      if (extFilter && ext !== extFilter && !name.endsWith(extFilter)) continue;
      if (ext && !CODE_EXTENSIONS.has(ext) && !extFilter) continue;
      try {
        const text = readFileSync(full, "utf8");
        if (fileMatchesAnyTerm(text, terms)) {
          hits.push(full);
        }
      } catch {
        /* skip binary/unreadable */
      }
    }
  }
  return hits;
}

function runRipgrep(
  pattern: string,
  root: string,
  extension?: string,
  maxResults = DEFAULT_MAX_RESULTS,
): Promise<string[]> {
  return new Promise((resolve) => {
    const args = [
      "--line-number",
      "--no-heading",
      "--max-count",
      String(maxResults),
    ];
    for (const dir of [
      "node_modules",
      ".git",
      ".next",
      "dist",
      "build",
      "coverage",
    ]) {
      args.push("-g", `!${dir}/**`);
    }
    args.push(pattern, root);
    if (extension?.trim()) {
      args.unshift("-g", `*${extension.trim()}`);
    }

    const child = spawn("rg", args, { windowsHide: true });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, maxResults);
      resolve(lines);
    });
  });
}

export async function findCodeInProject(args: {
  query: string;
  projectRoot: string;
  extension?: string;
  maxResults?: number;
}): Promise<string> {
  const query = args.query.trim();
  const root = args.projectRoot.trim();
  if (!query) throw new Error("missing_query");
  if (!root || !existsSync(root)) throw new Error("project_root_missing");

  const maxResults = Math.min(args.maxResults ?? DEFAULT_MAX_RESULTS, 100);
  const terms = parseSearchTerms(query);
  if (!terms.length) throw new Error("missing_query");

  const pattern = buildRipgrepPattern(terms);
  const rgLines = await runRipgrep(pattern, root, args.extension, maxResults);
  if (rgLines.length > 0) {
    return truncateShellOutput(rgLines.join("\n"));
  }

  const hits = walkAndSearch(root, terms, args.extension, maxResults);
  if (hits.length === 0) {
    const label = terms.length > 1 ? terms.join(" | ") : terms[0]!;
    return `No matches for "${label}" under ${root}`;
  }
  return truncateShellOutput(
    hits.map((h) => {
      const lines = readFileSync(h, "utf8").split(/\r?\n/);
      const matches = lines
        .map((line, index) => ({ line, index: index + 1 }))
        .filter(({ line }) => fileMatchesAnyTerm(line, terms))
        .slice(0, 3)
        .map(({ line, index }) => `${h}:${index}:${line.trim().slice(0, 120)}`);
      return matches.length ? matches.join("\n") : h;
    }).join("\n"),
  );
}
