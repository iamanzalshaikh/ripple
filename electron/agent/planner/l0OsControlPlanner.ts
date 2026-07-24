import { getCompoundParts } from "./utteranceClassifier.js";
import type { L0PlannerResult } from "./planTypes.js";

const COPY_FOLDER =
  /^\s*copy\s+(?:the\s+)?folder\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
/** "copy X from Downloads to Desktop" — location must not stay inside sourceName. */
const COPY_FILE_FROM =
  /^\s*copy\s+(?:the\s+)?(?:file\s+)?(?:named\s+|called\s+)?(.+?)\s+from\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const COPY_FILE =
  /^\s*copy\s+(?:the\s+)?(?:file\s+)?(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const MOVE_FOLDER =
  /^\s*move\s+(?:the\s+)?folder\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const MOVE_FILE_FROM =
  /^\s*move\s+(?:the\s+)?(?:file\s+|folder\s+)?(?:named\s+|called\s+)?(.+?)\s+from\s+(?:my\s+|the\s+)?(downloads?|documents?|desktop)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i;
const COMPARE_DIRS =
  /^\s*compare\s+(?:the\s+|these\s+(?:two\s+)?|those\s+(?:two\s+)?|my\s+|two\s+)?(?:folders?|director(?:y|ies))\s*[:,]?\s+(.+?)\s+(?:and|with|to)\s+(.+?)\s*$/i;
const COMPARE_FILES =
  /^\s*compare\s+(?:the\s+|these\s+(?:two\s+)?|those\s+(?:two\s+)?|my\s+|two\s+)?files?\s*[:,]?\s+(.+?)\s+(?:and|with|to)\s+(.+?)\s*$/i;
/** Trailing "in/on Downloads|Documents|Desktop" belongs to the whole phrase, not the second folder name. */
const TRAILING_LOCATION =
  /\s+(?:in|on)\s+(?:my\s+)?(downloads?|documents?|desktop)\s*$/i;
const RUN_ADMIN =
  /^\s*(?:run|open|launch)\s+(.+?)\s+as\s+admin(?:istrator)?\s*$/i;
const APP_PROPS =
  /^\s*(?:show|get|what(?:'s| is))\s+(?:the\s+)?(?:app\s+)?(?:properties|version)\s+(?:of\s+|for\s+)?(.+?)\s*$/i;
const RUNNING =
  /^\s*(?:what apps are running|list running (?:apps|windows)|show running apps)\s*$/i;
const INSPECT =
  /^\s*inspect\s+(?:the\s+)?(?:window\s+)?(.+?)\s*$/i;
const SNAP_LEFT =
  /^\s*(?:put|move|place|snap)\s+(?:this|the|my)?\s*(?:app|window)?\s*(?:on|to)\s+(?:the\s+)?left(?:\s+side)?(?:\s+of\s+(?:my\s+|the\s+)?screen)?\s*$/i;
const SNAP_RIGHT =
  /^\s*(?:put|move|place|snap)\s+(?:this|the|my)?\s*(?:app|window)?\s*(?:on|to)\s+(?:the\s+)?right(?:\s+side)?(?:\s+of\s+(?:my\s+|the\s+)?screen)?\s*$/i;
const MAXIMIZE =
  /^\s*(?:make\s+(?:this|it)\s+(?:full\s*screen|fullscreen)|(?:go\s+)?full\s*screen|(?:maximize|maximise)(?:\s+(?:this|the|my)?\s*(?:window|app)?)?)\s*$/i;
const MINIMIZE_THIS =
  /^\s*(?:minimize|minimise)\s+(?:this|the|my)?\s*(?:window|app)?\s*$/i;
const SOMEWHERE_USEFUL =
  /^\s*(?:put|move|place|arrange)\s+(?:the\s+)?(?:(?:chrome|edge|firefox|cursor|notepad|powerpoint|word|excel)\s+)?(?:window|app)\s+somewhere\s+useful\s*$/i;

function strip(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

/**
 * "copy Reports to a new folder called Archive" — the destination clause is
 * "a new folder called Archive", not a folder name at all. Strip the filler
 * down to "Archive" so downstream resolution isn't handed unparseable prose
 * (which used to silently collapse to Desktop — see FEATURE_GAPS/W0.3).
 */
const NEW_FOLDER_PHRASE =
  /^(?:a\s+)?(?:brand[\s-]new\s+|new\s+)?folder\s+(?:called|named)\s+(.+)$/i;

function extractFolderName(raw: string): string {
  const stripped = strip(raw).replace(/[.,!?;:]+$/g, "").trim();
  const m = stripped.match(NEW_FOLDER_PHRASE);
  return m?.[1] ? strip(m[1]).replace(/[.,!?;:]+$/g, "").trim() : stripped;
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
      {
        left: strip(cmpDirs[1].replace(TRAILING_LOCATION, "")),
        right: strip(cmpDirs[2].replace(TRAILING_LOCATION, "")),
      },
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
      {
        left: strip(cmpFiles[1].replace(TRAILING_LOCATION, "")),
        right: strip(cmpFiles[2].replace(TRAILING_LOCATION, "")),
      },
      "l0_os_compare_files",
    );
  }

  // Copy/move with "to a new folder called X" must beat the compound gate —
  // "folder … to … folder" is a single OS action, not two clauses.
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
        destinationFolder: extractFolderName(copyFolder[2]),
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
        destinationFolder: extractFolderName(moveFolder[2]),
      },
      "l0_os_move_folder",
    );
  }

  const copyFileFrom = text.match(COPY_FILE_FROM) ?? nrm.match(COPY_FILE_FROM);
  if (copyFileFrom?.[1] && copyFileFrom?.[2] && copyFileFrom?.[3]) {
    return planResult(
      rawCommand,
      normalized,
      `Copy ${copyFileFrom[1]} from ${copyFileFrom[2]} → ${copyFileFrom[3]}`,
      0.9,
      "filesystem.copy_file",
      {
        sourceName: strip(copyFileFrom[1]),
        parentFolder: strip(copyFileFrom[2]),
        destinationFolder: extractFolderName(copyFileFrom[3]),
      },
      "l0_os_copy_file_from",
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
        destinationFolder: extractFolderName(copyFile[2]),
      },
      "l0_os_copy_file",
    );
  }

  const moveFileFrom = text.match(MOVE_FILE_FROM) ?? nrm.match(MOVE_FILE_FROM);
  if (moveFileFrom?.[1] && moveFileFrom?.[2] && moveFileFrom?.[3]) {
    return planResult(
      rawCommand,
      normalized,
      `Move ${moveFileFrom[1]} from ${moveFileFrom[2]} → ${moveFileFrom[3]}`,
      0.9,
      "filesystem.move_file",
      {
        sourceName: strip(moveFileFrom[1]),
        parentFolder: strip(moveFileFrom[2]),
        destinationFolder: extractFolderName(moveFileFrom[3]),
      },
      "l0_os_move_file_from",
    );
  }

  const parts = getCompoundParts(rawCommand, normalized);
  if (parts && parts.length >= 2) return null;

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

  if (SOMEWHERE_USEFUL.test(text) || SOMEWHERE_USEFUL.test(nrm)) {
    return {
      kind: "clarify",
      question:
        "Where should I put it — left half, right half, or maximize / full screen?",
      options: ["Left half", "Right half", "Maximize"],
      confidence: 0.7,
      reason: "window_arrange_ambiguous",
    };
  }

  if (SNAP_LEFT.test(text) || SNAP_LEFT.test(nrm)) {
    return planResult(
      rawCommand,
      normalized,
      "Snap window left",
      0.92,
      "window.snap",
      { side: "left" },
      "l0_os_window_snap_left",
    );
  }

  if (SNAP_RIGHT.test(text) || SNAP_RIGHT.test(nrm)) {
    return planResult(
      rawCommand,
      normalized,
      "Snap window right",
      0.92,
      "window.snap",
      { side: "right" },
      "l0_os_window_snap_right",
    );
  }

  if (MAXIMIZE.test(text) || MAXIMIZE.test(nrm)) {
    return planResult(
      rawCommand,
      normalized,
      "Maximize window",
      0.92,
      "window.maximize",
      {},
      "l0_os_window_maximize",
    );
  }

  if (MINIMIZE_THIS.test(text) || MINIMIZE_THIS.test(nrm)) {
    return planResult(
      rawCommand,
      normalized,
      "Minimize window",
      0.9,
      "window.minimize",
      {},
      "l0_os_window_minimize",
    );
  }
    
  return null;
}
