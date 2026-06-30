import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  addAlias,
  listUserAliases,
  removeAlias,
} from "./aliasRegistry.js";
import {
  createFile,
  createFolder,
  confirmDeletePath,
  moveFile,
  openAliasTarget,
  renameFile,
  resolveFileBySpokenName,
} from "./fileOperations.js";
import { guidedMissingParent } from "../planner/guidedResponses.js";
import { openUrlInBrowser } from "../openUrl.js";
import {
  listWorkflows,
  parseWorkflowStepList,
  removeWorkflow,
  resolveWorkflowExact,
  runUserWorkflow,
  saveWorkflow,
  type WorkflowStepDef,
} from "./userWorkflows.js";
import { saveUserWorkspace } from "./workspaceRegistry.js";
import { findNativeAppById } from "./nativeAppRegistry.js";
import { launchNativeApp } from "./launchApp.js";
import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";
import { searchFileByNameAsync } from "./searchFiles.js";
import {
  closeAppWindow,
  focusAppWindow,
  minimizeAllWindows,
} from "./windowManager.js";
import { runSystemAction, type SystemActionId } from "./systemActions.js";
import { runRecallMemoryAction } from "./runSessionMemoryAction.js";
import { openDesktopItem } from "./openDesktopItem.js";
import {
  openSmartSearchResult,
  resolveSmartSearch,
} from "./intelligentSearch.js";
import { applyAppStateBeforeExecute } from "./appStateResolver.js";
import type { SmartSearchQuery } from "./parseSmartSearchCommand.js";
import { recordDesktopActionOutcome } from "../../storage/recordDesktopAction.js";
import { executeReferentialSend } from "../adapters/whatsapp/executeReferentialSend.js";
import {
  resolveReferentialContact,
} from "../voice/nlu/parseReferentialWhatsApp.js";
import { getLastCommandContext } from "../../storage/lastCommandState.js";
import type { RecallTarget } from "./parseSessionMemoryCommand.js";
import { confirmIfNeeded } from "../safety/executionGuard.js";
import { recordCommandEvent } from "../../telemetry/commandTelemetry.js";
import { recordTrustSignal } from "../../storage/actionTrust.js";
import { upsertFileIndexPath } from "../../storage/fileIndex.js";
import { popUndoAction, peekUndoAction, pushUndoAction } from "../safety/undoStack.js";
import {
  reverseUndoAction,
  undoCreatePath,
  undoDeletePaths,
  undoMovePaths,
  undoRenamePaths,
} from "../safety/undoRunner.js";
import { describeUndoAction } from "../safety/undoDescribe.js";
import { upsertLifeEvent } from "../../storage/lifeEvents.js";
import { openGmailEmailFromSender } from "../gmail/openGmailEmail.js";

async function requireDestructiveConfirm(
  kind: string,
  data: Record<string, unknown> | undefined,
  slots: {
    sourceName?: string;
    newName?: string;
    destinationFolder?: string;
    parentFolder?: string;
    fileName?: string;
  },
): Promise<void> {
  await confirmIfNeeded(kind, slots, data);
}

async function executeDesktopOpenBatch(
  data?: Record<string, unknown>,
): Promise<string> {
  const kind = data?.desktopKind;

  if (kind === "undo_last") {
    const pending = peekUndoAction();
    if (!pending) {
      throw new Error("Nothing to undo — no recent file action");
    }
    const action = popUndoAction();
    if (!action) {
      throw new Error("Nothing to undo — no recent file action");
    }
    const result = await reverseUndoAction(action);
    const label = describeUndoAction(action);
    recordCommandEvent({
      command: String(data?.command ?? "undo"),
      outcome: "undo",
      detail: label,
    });
    recordTrustSignal(String(data?.command ?? "undo"), "undo");
    return `${result} (${label})`;
  }

  if (kind === "open_resolved") {
    const path =
      typeof data?.resolvedPath === "string" ? data.resolvedPath : "";
    if (!path || !existsSync(path)) {
      throw new Error("Resolved path missing or not found");
    }
    if (data) data.resolvedPath = path;
    if (statSync(path).isDirectory()) {
      return openFolder(path);
    }
    return openFile(path);
  }

  if (kind === "folder") {
    const folder =
      typeof data?.folder === "string" ? data.folder : "downloads";
    const resolved = resolveFolderPath(folder);
    if (data) data.resolvedPath = resolved;
    return openFolder(resolved);
  }

  if (kind === "file") {
    const filename = typeof data?.filename === "string" ? data.filename : "";
    if (!filename.trim()) {
      throw new Error("No filename in desktop command");
    }
    const found = await searchFileByNameAsync(filename);
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

  if (kind === "smart_search") {
    const label = typeof data?.smartLabel === "string" ? data.smartLabel : "search";
    const query = data?.smartQuery as SmartSearchQuery | undefined;
    if (!query || typeof query !== "object" || !("type" in query)) {
      throw new Error("Smart search query missing");
    }
    const path = await resolveSmartSearch(query, label);
    const result = await openSmartSearchResult(path);
    if (data) data.resolvedPath = path;
    return result;
  }

  if (kind === "remember_life_event") {
    const label =
      typeof data?.lifeEventLabel === "string" ? data.lifeEventLabel : "";
    const topic =
      typeof data?.lifeEventTopic === "string" ? data.lifeEventTopic : "";
    const eventAt =
      typeof data?.lifeEventAt === "string" ? data.lifeEventAt : "";
    if (!label || !topic || !eventAt) {
      throw new Error("Life event label, topic, or date missing");
    }
    upsertLifeEvent({ label, topic, eventAt });
    return `Remembered life event: ${label}`;
  }

  if (kind === "open_gmail_email") {
    const senderQuery =
      typeof data?.gmailSenderQuery === "string" ? data.gmailSenderQuery : "";
    if (!senderQuery.trim()) {
      throw new Error("Gmail sender query missing");
    }
    return openGmailEmailFromSender(senderQuery.trim());
  }

  if (kind === "recall_memory") {
    const target = data?.recallTarget;
    const valid: RecallTarget[] = [
      "auto",
      "file",
      "pdf",
      "video",
      "image",
      "folder",
      "workspace",
      "app",
      "parent",
    ];
    if (
      typeof target !== "string" ||
      !valid.includes(target as RecallTarget)
    ) {
      throw new Error("Recall target missing or invalid");
    }
    const result = await runRecallMemoryAction(target as RecallTarget);
    const pathMatch = result.match(/Opened (?:file|folder):\s*(.+)$/i);
    if (pathMatch?.[1] && data) {
      data.resolvedPath = pathMatch[1].trim();
    }
    return result;
  }

  if (kind === "launch_app") {
    if (!data) throw new Error("Launch app data missing");
    await applyAppStateBeforeExecute("launch_app", data);
    const effectiveKind = data?.desktopKind;
    if (effectiveKind === "switch_app") {
      const appId = typeof data?.appId === "string" ? data.appId : "";
      const app = findNativeAppById(appId);
      if (!app) throw new Error(`Unknown app: ${appId}`);
      return focusAppWindow(app);
    }
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
    if (!parent?.trim()) throw new Error(guidedMissingParent("folder"));
    const parentPath = resolveFolderPath(parent);
    const folderPath = join(parentPath, folderName.trim());
    const result = await createFolder(folderName, parent);
    pushUndoAction(undoCreatePath(folderPath));
    return result;
  }

  if (kind === "create_file") {
    const fileName = typeof data?.fileName === "string" ? data.fileName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!fileName.trim()) throw new Error("File name required");
    if (!parent?.trim()) throw new Error(guidedMissingParent("file"));
    await requireDestructiveConfirm("create_file", data, {
      fileName,
      parentFolder: parent,
    });
    const parentPath = resolveFolderPath(parent);
    let filename = fileName.trim();
    if (!/\.[a-z0-9]{2,8}$/i.test(filename)) filename = `${filename}.txt`;
    const filePath = join(parentPath, filename);
    const result = await createFile(fileName, parent);
    pushUndoAction(undoCreatePath(filePath));
    return result;
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
    await requireDestructiveConfirm("rename_file", data, {
      sourceName,
      newName,
      parentFolder: parent,
    });
    const from = await resolveFileBySpokenName(sourceName, parent);
    const to = join(dirname(from), basename(newName.trim()));
    const result = await renameFile(sourceName, newName, parent);
    pushUndoAction(undoRenamePaths(from, to));
    return result;
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
    await requireDestructiveConfirm("move_file", data, {
      sourceName,
      destinationFolder: destination,
      parentFolder: parent,
    });
    const from = await resolveFileBySpokenName(sourceName, parent);
    const destDir = resolveFolderPath(destination);
    const to = join(destDir, basename(from));
    const result = await moveFile(sourceName, destination, parent);
    pushUndoAction(undoMovePaths(from, to));
    return result;
  }

  if (kind === "delete_file") {
    const sourceName =
      typeof data?.sourceName === "string" ? data.sourceName : "";
    const parent =
      typeof data?.parentFolder === "string" ? data.parentFolder : undefined;
    if (!sourceName.trim()) throw new Error("File name required");
    await requireDestructiveConfirm("delete_file", data, {
      sourceName,
      parentFolder: parent,
    });
    const sourcePath = await resolveFileBySpokenName(sourceName, parent);
    if (data?._safetyConfirmed !== true) {
      const ok = await confirmDeletePath(sourcePath);
      if (!ok) throw new Error("Delete cancelled");
    }
    const backupPath = stageDeleteBackup(sourcePath);
    pushUndoAction(undoDeletePaths(sourcePath, backupPath));
    upsertFileIndexPath(sourcePath);
    console.info(`[ripple-desktop] Deleted → ${sourcePath} (backup: ${backupPath})`);
    return `Deleted ${basename(sourcePath)}`;
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
      version:
        typeof data?.workflowVersion === "number"
          ? data.workflowVersion
          : undefined,
    });
  }

  if (kind === "remember_workflow") {
    const name =
      typeof data?.workflowName === "string" ? data.workflowName : "";
    const raw =
      typeof data?.workflowStepsRaw === "string" ? data.workflowStepsRaw : "";
    if (!name || !raw) throw new Error("Workflow name and steps required");
    const steps = parseWorkflowStepList(raw);
    const replace = data?.workflowReplace === true;
    const existing = resolveWorkflowExact(name);
    const entry = saveWorkflow(name, steps, {
      replace: replace || Boolean(existing),
    });
    const stepLabels = steps.map((s) => `${s.type}:${s.target}`).join(" -> ");
    return `Remembered workflow "${entry.name}" v${entry.version ?? 1} [${stepLabels}]`;
  }

  if (kind === "list_workflows") {
    const workflows = listWorkflows();
    if (workflows.length === 0) {
      return 'No workflows yet. Say e.g. "Remember work mode opens VS Code, GitHub, and Render"';
    }
    const lines = workflows.map(
      (w) => `${w.name} v${w.version ?? 1} (${w.steps.length} steps)`,
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

  if (kind === "referential_send") {
    const contactRaw =
      typeof data?.contact === "string" ? data.contact : "";
    const mode =
      data?.sendMode === "message_again" ? "message_again" : "send_file";
    const contact = resolveReferentialContact(
      contactRaw,
      getLastCommandContext().last_contact,
    );
    if (!contact) {
      throw new Error(
        'No contact in session — say e.g. "Send it to Noor" or message someone first',
      );
    }
    const sourcePath =
      typeof data?.sourcePath === "string" ? data.sourcePath : undefined;
    const ctx = getLastCommandContext();
    const result = await executeReferentialSend(
      { kind: "referential_send", contact, mode },
      typeof data?.command === "string" ? data.command : "",
      sourcePath ? { sourcePath } : undefined,
    );
    if (data) {
      data.contact = contact;
      const sentPath =
        sourcePath?.trim() || ctx.last_file || ctx.last_folder || undefined;
      if (sentPath) data.resolvedPath = sentPath;
    }
    return result;
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
