import { getCompoundParts } from "./utteranceClassifier.js";
import type { L0PlannerResult } from "./planTypes.js";

const COPY_FOLDER =
  /^\s*copy\s+(?:the\s+)?folder\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const COPY_FILE =
  /^\s*copy\s+(?:the\s+)?(?:file\s+)?(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const MOVE_FOLDER =
  /^\s*move\s+(?:the\s+)?folder\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const COMPARE_DIRS =
  /^\s*compare\s+(?:the\s+)?(?:folders?|director(?:y|ies))\s+(.+?)\s+(?:and|with|to)\s+(.+?)\s*$/i;
const COMPARE_FILES =
  /^\s*compare\s+(?:the\s+)?files?\s+(.+?)\s+(?:and|with|to)\s+(.+?)\s*$/i;
const RUN_ADMIN =
  /^\s*(?:run|open|launch)\s+(.+?)\s+as\s+admin(?:istrator)?\s*$/i;
const APP_PROPS =
  /^\s*(?:show|get|what(?:'s| is))\s+(?:the\s+)?(?:app\s+)?(?:properties|version)\s+(?:of\s+|for\s+)?(.+?)\s*$/i;
const RUNNING =
  /^\s*(?:what apps are running|list running (?:apps|windows)|show running apps)\s*$/i;
const INSPECT =
  /^\s*inspect\s+(?:the\s+)?(?:window\s+)?(.+?)\s*$/i;

function strip(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function planResult(
  rawCommand: string,
  normalized: string,
  goal: string,
  confidence: number,
  tool: string,
  args: Record<string, unknown>,
  reason: string,
): L0PlannerResult {
  return {
    kind: "plan",
    plan: {
      goal,
      confidence,
      steps: [{ tool, args, reason }],
      rawUtterance: rawCommand,
      normalizedUtterance: normalized,
      source: "L0",
    },
  };
}

/**
 * P5.6 — OS Control (hands) L0 routes.
 * Compare-with-"and" is checked before compound gate.
 */
export function tryL0OsControlPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const text = rawCommand.trim();
  const nrm = normalized.trim();

  const cmpDirs = text.match(COMPARE_DIRS) ?? nrm.match(COMPARE_DIRS);
  if (cmpDirs?.[1] && cmpDirs?.[2]) {
    return planResult(
      rawCommand,
      normalized,
      "Compare directories",
      0.9,
      "filesystem.compare_directories",
      { left: strip(cmpDirs[1]), right: strip(cmpDirs[2]) },
      "l0_os_compare_dirs",
    );
  }

  const cmpFiles = text.match(COMPARE_FILES) ?? nrm.match(COMPARE_FILES);
  if (cmpFiles?.[1] && cmpFiles?.[2]) {
    return planResult(
      rawCommand,
      normalized,
      "Compare files",
      0.9,
      "filesystem.compare_files",
      { left: strip(cmpFiles[1]), right: strip(cmpFiles[2]) },
      "l0_os_compare_files",
    );
  }

  const parts = getCompoundParts(rawCommand, normalized);
  if (parts && parts.length >= 2) return null;

  const copyFolder = text.match(COPY_FOLDER) ?? nrm.match(COPY_FOLDER);
  if (copyFolder?.[1] && copyFolder?.[2]) {
    return planResult(
      rawCommand,
      normalized,
      `Copy folder ${copyFolder[1]} → ${copyFolder[2]}`,
      0.9,
      "filesystem.copy_folder",
      {
        sourceName: strip(copyFolder[1]),
        destinationFolder: strip(copyFolder[2]),
      },
      "l0_os_copy_folder",
    );
  }

  const moveFolder = text.match(MOVE_FOLDER) ?? nrm.match(MOVE_FOLDER);
  if (moveFolder?.[1] && moveFolder?.[2]) {
    return planResult(
      rawCommand,
      normalized,
      `Move folder ${moveFolder[1]} → ${moveFolder[2]}`,
      0.9,
      "filesystem.move_folder",
      {
        sourceName: strip(moveFolder[1]),
        destinationFolder: strip(moveFolder[2]),
      },
      "l0_os_move_folder",
    );
  }

  const copyFile = text.match(COPY_FILE) ?? nrm.match(COPY_FILE);
  if (copyFile?.[1] && copyFile?.[2]) {
    return planResult(
      rawCommand,
      normalized,
      `Copy ${copyFile[1]} → ${copyFile[2]}`,
      0.88,
      "filesystem.copy_file",
      {
        sourceName: strip(copyFile[1]),
        destinationFolder: strip(copyFile[2]),
      },
      "l0_os_copy_file",
    );
  }

  const admin = text.match(RUN_ADMIN) ?? nrm.match(RUN_ADMIN);
  if (admin?.[1]) {
    return planResult(
      rawCommand,
      normalized,
      `Run ${admin[1]} as admin`,
      0.91,
      "os.run_as_admin",
      { app: strip(admin[1]) },
      "l0_os_run_admin",
    );
  }

  const props = text.match(APP_PROPS) ?? nrm.match(APP_PROPS);
  if (props?.[1]) {
    return planResult(
      rawCommand,
      normalized,
      `App properties: ${props[1]}`,
      0.88,
      "os.get_app_properties",
      { app: strip(props[1]) },
      "l0_os_app_props",
    );
  }

  if (RUNNING.test(text) || RUNNING.test(nrm)) {
    return planResult(
      rawCommand,
      normalized,
      "List running apps",
      0.9,
      "os.get_running_apps",
      {},
      "l0_os_running_apps",
    );
  }

  const inspect = text.match(INSPECT) ?? nrm.match(INSPECT);
  if (inspect?.[1]) {
    return planResult(
      rawCommand,
      normalized,
      `Inspect window: ${inspect[1]}`,
      0.86,
      "window.inspect",
      { query: strip(inspect[1]) },
      "l0_os_window_inspect",
    );
  }
    
  return null;
}
