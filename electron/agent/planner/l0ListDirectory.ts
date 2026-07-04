import { normalizeFolderKey } from "../../automation/desktop/folderIntent.js";
import type { ExecutionPlan, PlanStep } from "./planTypes.js";

export function parseListDirectoryCommand(
  command?: string | null,
): { parentFolder: string } | null {
  const cmd = (command ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!cmd) return null;

  const patterns = [
    /^(?:list|show)\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?files?\s+(?:in|on)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/,
    /^(?:list|show)\s+(?:what(?:'s| is)\s+)?(?:in|on)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/,
    /^what(?:'s| is) in (?:my\s+)?(downloads?|documents?|desktop)\s*$/,
  ];

  for (const pattern of patterns) {
    const match = cmd.match(pattern);
    const folderRaw = match?.[1];
    if (!folderRaw) continue;
    const folder = normalizeFolderKey(folderRaw);
    if (folder) return { parentFolder: folder };
  }

  return null;
}

export function planFromListDirectory(
  parentFolder: string,
  rawCommand: string,
  normalized: string,
): ExecutionPlan {
  const step: PlanStep = {
    tool: "filesystem.list_directory",
    args: { parentFolder },
    reason: "list_directory",
  };
  return {
    goal: `List ${parentFolder}`,
    confidence: 0.9,
    steps: [step],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}
