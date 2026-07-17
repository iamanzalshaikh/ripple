/**
 * P5.4 — voice clause → automation intent (used by L0 + planner v2 classifier).
 */
import { normalizeWindowsPath, trimSpokenPathTail, clampToExistingPath } from "../../automation/shell/projectPathNormalize.js";

export type AutomationClauseIntent =
  | { kind: "open_project"; path?: string; projectHint?: string }
  | { kind: "find_code"; query: string; projectRoot?: string }
  | { kind: "analyze_codebase"; projectRoot?: string }
  | { kind: "typecheck"; projectRoot?: string }
  | { kind: "lint"; projectRoot?: string }
  | { kind: "inspect_files"; query?: string }
  | { kind: "run_tests"; projectRoot?: string }
  | { kind: "apply_fixes" }
  | { kind: "explain_issue" }
  | { kind: "git_status"; projectRoot?: string }
  | { kind: "git_diff"; projectRoot?: string }
  | { kind: "run_command"; command: string }
  | { kind: "open_terminal" }
  | { kind: "run_script"; scriptPath?: string };

function norm(command: string): string {
  return command
    .trim()
    .replace(/[`"']/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function stripQuotes(text: string): string {
  return text.replace(/^[`"'](.+)[`"']$/s, "$1").trim();
}

/** Extract a Windows path from spoken text. */
export function extractWindowsPath(text: string): string | null {
  const raw = text.trim();
  const quoted = raw.match(/["']([A-Za-z]:\\[^"']+)["']/);
  if (quoted?.[1]) {
    return clampToExistingPath(quoted[1].trim());
  }

  const stop =
    String.raw`(?=\s+(?:instead|because|rather|while|where|when|why|how|versus|vs\.?|detecting|detect|using|runs?|running|and|then|check|find|perform|run|analyze|inspect|audit|fix|open)\b|,|$|\.(?:\s|$))`;

  const patterns = [
    new RegExp(String.raw`([A-Za-z]:\\[^,\r\n]+?)${stop}`, "i"),
    /([A-Za-z]:\\.+?\))\s*(?:\.|,|;|\s+(?:Check|Perform|Find|Run|Analyze|Inspect|Audit|Fix|Open)\b)/i,
    /([A-Za-z]:\\[^\r\n]+?)(?=\s*[,;]\s*(?:and\s+)?(?:find|check|perform|run|analyze|inspect|audit|fix)\b)/i,
    /([A-Za-z]:\\[^\r\n]+)$/,
  ];

  for (const pattern of patterns) {
    const m = raw.match(pattern);
    const candidate = m?.[1]?.trim();
    if (!candidate) continue;
    const cleaned = clampToExistingPath(candidate);
    if (cleaned.length >= 4) return cleaned;
  }

  return null;
}

export function parseAutomationClause(
  command?: string | null,
): AutomationClauseIntent | null {
  const raw = (command ?? "").trim();
  if (!raw) return null;
  const cmd = norm(raw);
  const nrm = cmd;

  if (/^open (?:windows )?terminal\b/.test(cmd) || /^open terminal\b/.test(nrm)) {
    return { kind: "open_terminal" };
  }

  const openProjectPath =
    raw.match(/^\s*open\s+(?:the\s+)?project\s+(.+?)\s*$/i) ??
    raw.match(/^\s*open\s+(?:the\s+)?(?:workspace|codebase)\s+(.+?)\s*$/i);
  if (openProjectPath?.[1]) {
    const tail = stripQuotes(openProjectPath[1].trim());
    const winPath = extractWindowsPath(tail);
    if (winPath) {
      return { kind: "open_project", path: winPath };
    }
    if (tail.length >= 2) {
      return { kind: "open_project", projectHint: tail };
    }
  }

  const openNamedProject =
    cmd.match(/^open (?:my|the)\s+(.+?)\s+(?:backend\s+)?project$/) ??
    nrm.match(/^open (?:my|the)\s+(.+?)\s+(?:backend\s+)?project$/);
  if (openNamedProject?.[1]) {
    const hint = openNamedProject[1].trim();
    if (!/^(?:cursor|notepad|chrome|edge|terminal)$/i.test(hint)) {
      return { kind: "open_project", projectHint: hint };
    }
  }

  const openFolderFrom =
    cmd.match(
      /^open (?:the\s+)?(.+?)\s+(?:folder|project)\s+from\s+(?:the\s+)?(desktop|documents|downloads)$/,
    ) ??
    nrm.match(
      /^open (?:the\s+)?(.+?)\s+(?:folder|project)\s+from\s+(?:the\s+)?(desktop|documents|downloads)$/,
    );
  if (openFolderFrom?.[1] && openFolderFrom[2]) {
    const hint = `${openFolderFrom[1].trim()} ${openFolderFrom[2]}`;
    return { kind: "open_project", projectHint: hint };
  }

  const openFolderOnly =
    cmd.match(/^open (?:the\s+)?(.+?)\s+folder$/) ??
    nrm.match(/^open (?:the\s+)?(.+?)\s+folder$/);
  if (openFolderOnly?.[1]) {
    const hint = openFolderOnly[1].trim();
    if (!/^(?:new|windows|empty)$/i.test(hint)) {
      return { kind: "open_project", projectHint: hint };
    }
  }

  const openFromLocation =
    cmd.match(/^open (?:the\s+)?(.+?)\s+from\s+(?:the\s+)?(desktop|documents|downloads)$/) ??
    nrm.match(/^open (?:the\s+)?(.+?)\s+from\s+(?:the\s+)?(desktop|documents|downloads)$/);
  if (openFromLocation?.[1] && openFromLocation[2]) {
    const hint = `${openFromLocation[1].trim()} ${openFromLocation[2]}`;
    return { kind: "open_project", projectHint: hint };
  }

  if (
    /^open (?:my )?(?:development |dev )?project\b/.test(cmd) ||
    /^open (?:the )?(?:workspace|codebase)\b/.test(cmd)
  ) {
    return { kind: "open_project", projectHint: "current" };
  }

  const openSpokenProject =
    cmd.match(/^open (?:my\s+)?([\w][\w\s-]{1,48})$/i) ??
    nrm.match(/^open (?:my\s+)?([\w][\w\s-]{1,48})$/i);
  if (openSpokenProject?.[1] && !extractWindowsPath(raw)) {
    const hint = openSpokenProject[1].trim();
    if (
      !/^(?:cursor|notepad|chrome|edge|terminal|downloads?|documents?|desktop|whatsapp|youtube)$/i.test(
        hint,
      )
    ) {
      return { kind: "open_project", projectHint: hint };
    }
  }

  if (
    /analyze (?:the )?(?:entire )?codebase/.test(cmd) ||
    /analyze (?:the )?code(?:\s*base)?/.test(cmd) ||
    /analyze (?:the )?project structure/.test(cmd) ||
    /inspect (?:the )?(?:project )?structure/.test(cmd) ||
    /(?:inspect|scan|debug|review|check) (?:the )?(?:code|codebase|project).*(?:issues?|errors?|bugs?)/.test(
      cmd,
    )
  ) {
    return { kind: "analyze_codebase", projectRoot: "." };
  }

  if (
    /(?:run\s+)?typescript(?:\s+type[\s-]?check)?/.test(cmd) ||
    /\btype[\s-]?check\b/.test(cmd) ||
    /\btsc\b/.test(cmd) ||
    /typescript compiler/.test(cmd)
  ) {
    return { kind: "typecheck", projectRoot: "." };
  }

  if (/(?:run\s+)?eslint/.test(cmd) || /\blint\b/.test(cmd)) {
    return { kind: "lint", projectRoot: "." };
  }

  if (
    /identify (?:any )?(?:errors?|bugs?|issues?|broken|problems?)/.test(cmd) ||
    /find (?:any )?(?:errors?|bugs?|issues?|broken functionality|code issues?|existing code)/.test(cmd) ||
    /find\b[\s\w'-]{0,40}?\b(?:bugs?|errors?|issues?|problems?)\b[\s\w'-]{0,40}?\b(?:in\s+(?:my\s+)?(?:current\s+)?(?:code|project|repo|codebase)|(?:current\s+)?code)?/.test(
      cmd,
    ) ||
    /(?:find|check|scan|review)\b[\s\w'-]{0,24}?\b(?:potential|possible)?\s*(?:bugs?|errors?|issues?)\b/.test(
      cmd,
    )
  ) {
    return {
      kind: "analyze_codebase",
      projectRoot: ".",
    };
  }

  if (
    /find affected files?/.test(cmd) ||
    /locate affected files?/.test(cmd) ||
    /^(?:open (?:my )?)?affected files?/.test(cmd)
  ) {
    return { kind: "inspect_files", query: "error bug fix" };
  }

  const findCode =
    cmd.match(/^find (.+?) (?:inside|in) (?:my )?(.+?)(?:\s+project)?$/) ??
    nrm.match(/^find (.+?) (?:inside|in) (?:my )?(.+?)(?:\s+project)?$/);
  if (
    findCode?.[1] &&
    !/\bfiles?\b/.test(cmd) &&
    /\b(?:logic|handler|function|auth|authentication|code)\b/.test(findCode[1])
  ) {
    return {
      kind: "find_code",
      query: findCode[1].trim(),
      projectRoot: ".",
    };
  }

  if (/^explain (?:the )?root cause/.test(cmd) || /^explain (?:possible )?issues?/.test(cmd)) {
    return { kind: "explain_issue" };
  }

  if (
    /apply fixes?/.test(cmd) ||
    /fix (?:the )?(?:problems?|issues?|bugs?)/.test(cmd) ||
    /update the (?:affected )?files?/.test(cmd) ||
    /patch the (?:affected )?files?/.test(cmd)
  ) {
    return { kind: "apply_fixes" };
  }

  if (
    /^run tests?\b/.test(cmd) ||
    /run (?:the )?(?:appropriate )?project tests?/.test(cmd) ||
    /run (?:project )?tests? (?:and|to) (?:verify|report)/.test(cmd) ||
    /verify changes/.test(cmd) ||
    /check (?:the )?build/.test(cmd) ||
    /execute tests?/.test(cmd)
  ) {
    return { kind: "run_tests", projectRoot: "." };
  }

  if (/git status/.test(cmd)) {
    return { kind: "git_status", projectRoot: "." };
  }

  if (/code changes|git diff|current changes/.test(cmd)) {
    return { kind: "git_diff", projectRoot: "." };
  }

  if (/^run the build script/.test(cmd)) {
    return { kind: "run_script", scriptPath: "build.ps1" };
  }

  const runCmd =
    cmd.match(/^run (.+?)(?:\s+in terminal)?$/) ??
    nrm.match(/^run (.+?)(?:\s+in terminal)?$/);
  if (runCmd?.[1] && !/^open\b/.test(runCmd[1])) {
    const phrase = runCmd[1].trim();
    if (/^tests?\b/.test(phrase)) {
      return { kind: "run_tests", projectRoot: "." };
    }
    let shell = phrase;
    if (/node version/.test(phrase)) shell = "node --version";
    else if (/npm version/.test(phrase)) shell = "npm --version";
    else if (/npm install/.test(phrase)) shell = "npm install --dry-run";
    return { kind: "run_command", command: shell };
  }

  return null;
}
