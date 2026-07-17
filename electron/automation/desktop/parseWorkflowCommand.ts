import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import {
  listWorkflows,
  parseWorkflowStepList,
  resolveWorkflowExact,
  type UserWorkflow,
} from "./userWorkflows.js";
import {
  extractLastRunPhrase,
  sanitizeSpokenName,
} from "./spokenName.js";

export type WorkflowIntent =
  | { kind: "run_workflow"; workflow: UserWorkflow; spokenName: string }
  | {
      kind: "remember_workflow";
      name: string;
      stepsRaw: string;
      replace?: boolean;
    }
  | { kind: "list_workflows" }
  | { kind: "remove_workflow"; name: string };

function parseWorkflowVersion(
  spoken: string,
): { name: string; version?: number } {
  const match = spoken.match(/^(.+?)\s+v(\d+)\s*$/i);
  if (!match?.[1] || !match[2]) {
    return { name: sanitizeSpokenName(spoken) };
  }
  return {
    name: sanitizeSpokenName(match[1]),
    version: Number.parseInt(match[2], 10),
  };
}

/** Folder/file paths — not multi-app workflow step lists. */
function looksLikeFolderPath(rest: string): boolean {
  const r = rest.toLowerCase();
  return (
    /\b(in\s+)?(downloads?|documents?|desktop)\b/.test(r) ||
    /\busers\b/.test(r) ||
    /^see\s+users\b/.test(r) ||
    /:\\/.test(rest) ||
    /^[a-z]\s+(users|projects|work)\b/i.test(rest)
  );
}

function rememberWorkflowIntent(
  name: string,
  stepsRaw: string,
  replace = false,
): WorkflowIntent {
  const cleanName = sanitizeSpokenName(name);
  const steps = parseWorkflowStepList(stepsRaw);
  const stepLabels = steps.map((s) => `${s.type}:${s.target}`).join(" -> ");
  console.info(
    `[ripple-desktop] you said: remember workflow "${cleanName}" with [${stepLabels}]${replace ? " (replace)" : ""}`,
  );
  return {
    kind: "remember_workflow",
    name: cleanName,
    stepsRaw: stepsRaw.trim(),
    replace,
  };
}

function normalizeWorkflowTranscript(command: string): string {
  return normalizeTranscript(command)
    .replace(/\bmode\s*open\b/gi, "mode open")
    .replace(/([a-z])(open\s+)/gi, "$1 $2");
}

export function parseWorkflowMetaCommand(
  command?: string | null,
): WorkflowIntent | null {
  const cmd = normalizeWorkflowTranscript(command ?? "");
  if (!cmd) return null;

  if (/(?:^|\s)(?:list|show)\s+(?:my\s+)?workflows?\s*\.?\s*$/i.test(cmd)) {
    return { kind: "list_workflows" };
  }

  const forgetWorkflow = cmd.match(
    /^\s*(?:forget|remove)\s+workflow\s*,?\s*(.+?)\s*\.?\s*$/i,
  );
  if (forgetWorkflow?.[1]) {
    return { kind: "remove_workflow", name: sanitizeSpokenName(forgetWorkflow[1]) };
  }

  const replaceOpens = cmd.match(
    /^\s*replace\s+(?:my\s+)?(.+?)\s+opens?\s+(.+?)\s*\.?\s*$/i,
  );
  if (replaceOpens?.[1] && replaceOpens[2]) {
    return rememberWorkflowIntent(replaceOpens[1], replaceOpens[2], true);
  }

  const replaceOpen = cmd.match(
    /^\s*replace\s+(?:my\s+)?(.+?)\s+open\s+(.+?)\s*\.?\s*$/i,
  );
  if (replaceOpen?.[1] && replaceOpen[2]) {
    return rememberWorkflowIntent(replaceOpen[1], replaceOpen[2], true);
  }

  const replaceWith = cmd.match(
    /^\s*replace\s+(?:my\s+)?(.+?)\s+with\s+(.+?)\s*\.?\s*$/i,
  );
  if (replaceWith?.[1] && replaceWith[2]) {
    return rememberWorkflowIntent(replaceWith[1], replaceWith[2], true);
  }

  // "Remember work mode opens VS Code, GitHub, and Render"
  const rememberOpens = cmd.match(
    /^\s*remember\s+(?:my\s+)?(.+?)\s+opens?\s+(.+?)\s*\.?\s*$/i,
  );
  if (rememberOpens?.[1] && rememberOpens[2]) {
    return rememberWorkflowIntent(rememberOpens[1], rememberOpens[2]);
  }

  // "Remember work mode open anti-gravity, YouTube" (after comma cleanup)
  const rememberOpen = cmd.match(
    /^\s*remember\s+(?:my\s+)?(.+?)\s+open\s+(.+?)\s*\.?\s*$/i,
  );
  if (rememberOpen?.[1] && rememberOpen[2]) {
    return rememberWorkflowIntent(rememberOpen[1], rememberOpen[2]);
  }

  // "Remember study mode, open notion, YouTube and documents"
  const rememberCommaOpen = cmd.match(
    /^\s*remember\s+(?:my\s+)?(.+?),\s*open[,\s]+(.+?)\s*\.?\s*$/i,
  );
  if (rememberCommaOpen?.[1] && rememberCommaOpen[2]) {
    return rememberWorkflowIntent(rememberCommaOpen[1], rememberCommaOpen[2]);
  }

  const rememberIs = cmd.match(
    /^\s*remember\s+(?:my\s+)?(.+?)\s+is\s+(.+?)\s*\.?\s*$/i,
  );
  if (rememberIs?.[1] && rememberIs[2]) {
    const name = rememberIs[1].trim();
    const rest = rememberIs[2].trim();
    if (
      !/^https?:\/\//i.test(rest) &&
      (rest.includes(",") || /\s+and\s+/i.test(rest)) &&
      !looksLikeFolderPath(rest)
    ) {
      return rememberWorkflowIntent(name, rest);
    }
  }

  return null;
}

/** "Start work mode" — uses last phrase when user self-corrects. */
export function parseWorkflowRunCommand(
  command?: string | null,
): WorkflowIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  // Shell/automation commands — not named user workflows.
  if (
    /^\s*run\s+.+\b(?:command|terminal|script|tests?)\b/i.test(cmd) ||
    /^\s*run\s+(?:node|npm|git)\b/i.test(cmd)
  ) {
    return null;
  }

  const spoken = extractLastRunPhrase(cmd);
  if (!spoken) return null;

  const { name, version } = parseWorkflowVersion(spoken);
  const workflow = resolveWorkflowExact(name, version);
  if (!workflow) {
    console.info(
      `[ripple-desktop] you said: "${cmd}" → no workflow named "${name}"${version ? ` v${version}` : ""} (say List my workflows)`,
    );
    return null;
  }

  console.info(
    `[ripple-desktop] you said: "${cmd}" → run workflow "${workflow.name}" v${workflow.version ?? 1}`,
  );

  return { kind: "run_workflow", workflow, spokenName: name };
}
