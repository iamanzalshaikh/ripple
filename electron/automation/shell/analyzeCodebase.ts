import { existsSync } from "node:fs";
import { truncateShellOutput } from "./runCommand.js";
import {
  listProjectSourceFiles,
  readTextFile,
  resolvePriorityFiles,
  sortFilesForAnalysis,
} from "./projectScan.js";

export type FileIssue = {
  file: string;
  rel: string;
  issues: string[];
};

type Heuristic = {
  id: string;
  analyze: (content: string, rel: string) => string[];
};

const HEURISTICS: Heuristic[] = [
  {
    id: "markers",
    analyze: (content) => {
      const hits: string[] = [];
      for (const line of content.split(/\r?\n/)) {
        if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
          hits.push(line.trim().slice(0, 120));
          if (hits.length >= 2) break;
        }
      }
      return hits.map((h) => `Marker comment: ${h}`);
    },
  },
  {
    id: "console-error",
    analyze: (content) => {
      if (!/console\.error/.test(content)) return [];
      const count = (content.match(/console\.error/g) ?? []).length;
      return [
        `Uses console.error (${count}×) — consider structured API error responses`,
      ];
    },
  },
  {
    id: "prisma-client",
    analyze: (content, rel) => {
      if (!/PrismaClient/.test(content)) return [];
      const hasSingleton =
        /globalForPrisma|globalThis/.test(content) &&
        /export\s+(const|let|var)\s+\w+/.test(content);
      if (hasSingleton) return [];
      if (/new PrismaClient/.test(content)) {
        return ["PrismaClient may be recreated on every import/request"];
      }
      return [];
    },
  },
  {
    id: "api-errors",
    analyze: (content, rel) => {
      const norm = rel.replace(/\\/g, "/");
      if (!norm.includes("/api/")) return [];
      const isRoute =
        /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/.test(content) ||
        /export\s+async\s+function\s+handler/.test(content);
      if (!isRoute) return [];
      if (/await/.test(content) && !/try\s*\{/.test(content)) {
        return ["API route awaits without try/catch error handling"];
      }
      return [];
    },
  },
  {
    id: "upload-validation",
    analyze: (content, rel) => {
      if (!/upload/i.test(rel)) return [];
      if (
        /formData|multipart|\.file|upload/i.test(content) &&
        !/zod|\.parse\(|validate|mimetype|fileSize|maxSize|allowedTypes/i.test(content)
      ) {
        return ["Upload handler may be missing file type/size validation"];
      }
      return [];
    },
  },
  {
    id: "auth-guard",
    analyze: (content, rel) => {
      if (!/auth|guard|session/i.test(rel)) return [];
      if (
        /useState/.test(content) &&
        /(auth|session|user|token)/i.test(content) &&
        !/useEffect/.test(content)
      ) {
        return ["Possible auth state race — session not loaded in useEffect"];
      }
      return [];
    },
  },
  {
    id: "empty-catch",
    analyze: (content) => {
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(content)) {
        return ["Empty catch block swallows errors"];
      }
      return [];
    },
  },
  {
    id: "env-secrets",
    analyze: (content, rel) => {
      if (!rel.includes(".env")) return [];
      if (/=(?:sk-|ghp_|AKIA|password\s*=\s*\S+)/i.test(content)) {
        return ["Possible secret committed in env file — verify .gitignore"];
      }
      return [];
    },
  },
];

function analyzePackageJson(content: string): string[] {
  const issues: string[] = [];
  try {
    const pkg = JSON.parse(content) as { scripts?: Record<string, string> };
    if (!pkg.scripts?.test?.trim()) {
      issues.push('No "test" script in package.json');
    }
    if (!pkg.scripts?.lint?.trim()) {
      issues.push('No "lint" script in package.json');
    }
  } catch {
    issues.push("package.json is not valid JSON");
  }
  return issues;
}

function analyzeFile(rel: string, content: string): string[] {
  const issues: string[] = [];
  if (rel.replace(/\\/g, "/").endsWith("package.json")) {
    issues.push(...analyzePackageJson(content));
  }
  for (const rule of HEURISTICS) {
    issues.push(...rule.analyze(content, rel));
  }
  return [...new Set(issues)];
}

export function analyzeProjectFiles(
  projectRoot: string,
  options?: { maxFiles?: number },
): FileIssue[] {
  const maxFiles = options?.maxFiles ?? 80;
  const sourceFiles = sortFilesForAnalysis(
    listProjectSourceFiles(projectRoot, { maxFiles: maxFiles * 2 }),
  ).slice(0, maxFiles);

  const priority = resolvePriorityFiles(projectRoot).filter((p) => p.exists);
  const seen = new Set<string>();
  const results: FileIssue[] = [];

  for (const item of priority) {
    seen.add(item.rel);
    const content = readTextFile(item.path);
    if (!content) continue;
    const issues = analyzeFile(item.rel, content);
    if (issues.length) results.push({ file: item.path, rel: item.rel, issues });
  }

  for (const file of sourceFiles) {
    if (seen.has(file.rel)) continue;
    const content = readTextFile(file.path);
    if (!content) continue;
    const issues = analyzeFile(file.rel, content);
    if (issues.length) results.push({ file: file.path, rel: file.rel, issues });
  }

  return results;
}

export async function analyzeCodebase(projectRoot: string): Promise<string> {
  const root = projectRoot.trim();
  if (!root || !existsSync(root)) {
    throw new Error("project_root_missing");
  }

  const priority = resolvePriorityFiles(root).filter((p) => p.exists);
  const analyzed = analyzeProjectFiles(root, { maxFiles: 80 });

  const lines: string[] = [`Analyzing codebase: ${root}`, ""];
  lines.push("Scanning:");
  for (const item of priority) {
    lines.push(`  ✓ ${item.rel}`);
  }

  const areas = new Set(
    listProjectSourceFiles(root, { maxFiles: 500 }).map((f) => f.area),
  );
  for (const area of [...areas].sort()) {
    if (area.startsWith("src/")) lines.push(`  ✓ ${area}`);
  }

  lines.push("");
  if (!analyzed.length) {
    lines.push("No heuristic issues found in scanned files.");
    lines.push(
      `Summary: ${priority.length + areas.size} areas checked, 0 issues flagged`,
    );
    return truncateShellOutput(lines.join("\n"));
  }

  lines.push("Found issues:");
  lines.push("");
  analyzed.slice(0, 12).forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.rel}`);
    for (const issue of entry.issues.slice(0, 3)) {
      lines.push(`   - ${issue}`);
    }
    lines.push("");
  });

  const fileCount = listProjectSourceFiles(root, { maxFiles: 500 }).length;
  lines.push(
    `Summary: ${fileCount} files scanned, ${analyzed.length} file${analyzed.length === 1 ? "" : "s"} with issues`,
  );

  return truncateShellOutput(lines.join("\n"));
}
