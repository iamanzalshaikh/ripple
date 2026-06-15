import {
  addAlias,
  listUserAliases,
  removeAlias,
} from "./aliasRegistry.js";
import {
  createFile,
  createFolder,
  deleteFile,
  moveFile,
  openAliasTarget,
  renameFile,
} from "./fileOperations.js";
import { openUrlInBrowser } from "../openUrl.js";
import {
  listWorkflows,
  parseWorkflowStepList,
  removeWorkflow,
  runUserWorkflow,
  saveWorkflow,
  type WorkflowStepDef,
} from "./userWorkflows.js";
import { saveUserWorkspace } from "./workspaceRegistry.js";
import { findNativeAppById } from "./nativeAppRegistry.js";
import { launchNativeApp } from "./launchApp.js";
import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";
import { searchFileByName } from "./searchFiles.js";
import {
  closeAppWindow,
  focusAppWindow,
  minimizeAllWindows,
} from "./windowManager.js";
import { runSystemAction, type SystemActionId } from "./systemActions.js";
import { runRecallMemoryAction } from "./runSessionMemoryAction.js";
import { openDesktopItem } from "./openDesktopItem.js";
import { recordDesktopActionOutcome } from "../../storage/recordDesktopAction.js";
import type { RecallTarget } from "./parseSessionMemoryCommand.js";

async function executeDesktopOpenBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.desktopKind;

  if (kind === "folder") {
    const folder =
      typeof data?.folder === "string" ? data.folder : "downloads";
    return openFolder(resolveFolderPath(folder));
  }

  if (kind === "file") {
    const filename = typeof data?.filename === "string" ? data.filename : "";
    if (!filename.trim()) {
      throw new Error("No filename in desktop command");
    }
    const found = searchFileByName(filename);
    if (!found) {
      throw new Error(
        `File not found: "${filename}" (searched Downloads, Documents, Desktop)`,
      );
    }
    console.info(`[ripple-desktop] Desktop file resolved → ${found}`);
    if (data) data.resolvedPath = found;
    return openFile(found);
  }

  if (kind === "item") {
    const itemName = typeof data?.itemName === "string" ? data.itemName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!itemName.trim()) {
      throw new Error("No file or folder name in desktop command");
    }
    const result = await openDesktopItem(itemName, parent as
      | "downloads"
      | "documents"
      | "desktop"
      | undefined);
    const pathMatch = result.match(/Opened (?:file|folder):\s*(.+)$/i);
    if (pathMatch?.[1] && data) {
      data.resolvedPath = pathMatch[1].trim();
    }
    return result;
  }

  if (kind === "recall_memory") {
    const target = data?.recallTarget;
    const valid: RecallTarget[] = [
      "auto",
      "file",
      "folder",
      "workspace",
      "app",
    ];
    if (
      typeof target !== "string" ||
      !valid.includes(target as RecallTarget)
    ) {
      throw new Error("Recall target missing or invalid");
    }
    return runRecallMemoryAction(target as RecallTarget);
  }

  if (kind === "launch_app") {
    const appId = typeof data?.appId === "string" ? data.appId : "";
    const app = findNativeAppById(appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    return launchNativeApp(app);
  }

  if (kind === "switch_app") {
    const appId = typeof data?.appId === "string" ? data.appId : "";
    const app = findNativeAppById(appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    return focusAppWindow(app);
  }

  if (kind === "close_app") {
    const appId = typeof data?.appId === "string" ? data.appId : "";
    const app = findNativeAppById(appId);
    if (!app) throw new Error(`Unknown app: ${appId}`);
    return closeAppWindow(app);
  }

  if (kind === "minimize_all") {
    return minimizeAllWindows();
  }

  if (kind === "system_action") {
    const actionId = data?.systemActionId;
    const valid: SystemActionId[] = [
      "lock_pc",
      "open_settings",
      "open_control_panel",
      "open_bluetooth_settings",
      "open_network_settings",
    ];
    if (
      typeof actionId !== "string" ||
      !valid.includes(actionId as SystemActionId)
    ) {
      throw new Error("System action id missing or invalid");
    }
    return runSystemAction(actionId as SystemActionId);
  }

  if (kind === "open_alias") {
    const aliasType = data?.aliasType;
    const aliasPath = typeof data?.aliasPath === "string" ? data.aliasPath : "";
    if (!aliasPath) throw new Error("Alias path missing");
    const type =
      aliasType === "folder" ||
      aliasType === "file" ||
      aliasType === "project" ||
      aliasType === "workspace"
        ? aliasType
        : "folder";
    return openAliasTarget(type, aliasPath);
  }

  if (kind === "remember_alias") {
    const name = typeof data?.aliasName === "string" ? data.aliasName : "";
    const path = typeof data?.aliasPath === "string" ? data.aliasPath : "";
    if (!name || !path) throw new Error("Alias name and path required");
    const entry = addAlias(name, path);
    return `Remembered "${entry.name}" → ${entry.path}`;
  }

  if (kind === "list_aliases") {
    const aliases = listUserAliases();
    if (aliases.length === 0) {
      return "You have no aliases yet. Say e.g. Remember portfolio is D:\\Projects\\Portfolio";
    }
    const lines = aliases.map((a) => `${a.name} (${a.type}) → ${a.path}`);
    return `Aliases:\n${lines.join("\n")}`;
  }

  if (kind === "remove_alias") {
    const name = typeof data?.aliasName === "string" ? data.aliasName : "";
    if (!name) throw new Error("Alias name required");
    const removedAlias = removeAlias(name);
    if (removedAlias) return `Removed alias "${name}"`;
    const removedWorkflow = removeWorkflow(name);
    if (removedWorkflow) return `Removed workflow "${name}"`;
    throw new Error(`No alias or workflow found for "${name}"`);
  }

  if (kind === "create_folder") {
    const folderName =
      typeof data?.folderName === "string" ? data.folderName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!folderName.trim()) throw new Error("Folder name required");
    return createFolder(folderName, parent);
  }

  if (kind === "create_file") {
    const fileName = typeof data?.fileName === "string" ? data.fileName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!fileName.trim()) throw new Error("File name required");
    return createFile(fileName, parent);
  }

  if (kind === "rename_file") {
    const sourceName =
      typeof data?.sourceName === "string" ? data.sourceName : "";
    const newName = typeof data?.newName === "string" ? data.newName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!sourceName.trim() || !newName.trim()) {
      throw new Error("Source and new filename required");
    }
    return renameFile(sourceName, newName, parent);
  }

  if (kind === "move_file") {
    const sourceName =
      typeof data?.sourceName === "string" ? data.sourceName : "";
    const destination =
      typeof data?.destinationFolder === "string"
        ? data.destinationFolder
        : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!sourceName.trim() || !destination.trim()) {
      throw new Error("Source file and destination required");
    }
    return moveFile(sourceName, destination, parent);
  }

  if (kind === "delete_file") {
    const sourceName =
      typeof data?.sourceName === "string" ? data.sourceName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!sourceName.trim()) throw new Error("File name required");
    return deleteFile(sourceName, parent);
  }

  if (kind === "open_workspace") {
    const url =
      typeof data?.workspaceUrl === "string" ? data.workspaceUrl : "";
    if (!url) throw new Error("Workspace URL missing");
    await openUrlInBrowser(url);
    const id =
      typeof data?.workspaceId === "string" ? data.workspaceId : "workspace";
    return `Opened ${id}`;
  }

  if (kind === "remember_workspace") {
    const name =
      typeof data?.workspaceName === "string" ? data.workspaceName : "";
    const url =
      typeof data?.workspaceUrl === "string" ? data.workspaceUrl : "";
    if (!name || !url) throw new Error("Workspace name and URL required");
    saveUserWorkspace(name, url, [name.toLowerCase()]);
    return `Remembered workspace "${name}" -> ${url}`;
  }

  if (kind === "run_workflow") {
    const workflowId =
      typeof data?.workflowId === "string" ? data.workflowId : "";
    const steps = data?.workflowSteps;
    if (!workflowId || !Array.isArray(steps)) {
      throw new Error("Workflow data missing");
    }
    return runUserWorkflow({
      id: workflowId,
      name: workflowId,
      steps: steps as WorkflowStepDef[],
    });
  }

  if (kind === "remember_workflow") {
    const name =
      typeof data?.workflowName === "string" ? data.workflowName : "";
    const raw =
      typeof data?.workflowStepsRaw === "string" ? data.workflowStepsRaw : "";
    if (!name || !raw) throw new Error("Workflow name and steps required");
    const steps = parseWorkflowStepList(raw);
    const entry = saveWorkflow(name, steps);
    const stepLabels = steps.map((s) => `${s.type}:${s.target}`).join(" -> ");
    return `Remembered workflow "${entry.name}" [${stepLabels}]`;
  }

  if (kind === "list_workflows") {
    const workflows = listWorkflows();
    if (workflows.length === 0) {
      return 'No workflows yet. Say e.g. "Remember work mode opens VS Code, GitHub, and Render"';
    }
    const lines = workflows.map(
      (w) => `${w.name} (${w.steps.length} steps)`,
    );
    return `Workflows:\n${lines.join("\n")}`;
  }

  if (kind === "remove_workflow") {
    const name =
      typeof data?.workflowName === "string" ? data.workflowName : "";
    if (!name) throw new Error("Workflow name required");
    const removed = removeWorkflow(name);
    if (!removed) throw new Error(`No workflow found for "${name}"`);
    return `Removed workflow "${name}"`;
  }

  throw new Error(`Unknown desktop command kind: ${String(kind)}`);
}

export async function runDesktopOpenBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const command = typeof data?.command === "string" ? data.command : "";
  const intent =
    typeof data?.desktopKind === "string" ? data.desktopKind : "desktop";

  try {
    const result = await executeDesktopOpenBatch(data);
    recordDesktopActionOutcome({
      command,
      intent,
      result,
      status: "ok",
      data,
    });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    recordDesktopActionOutcome({
      command,
      intent,
      result: msg,
      status: "error",
      data,
    });
    throw e;
  }
}
