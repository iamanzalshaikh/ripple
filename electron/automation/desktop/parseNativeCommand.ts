import { parseDesktopCommand, type DesktopOpenIntent } from "./parseDesktopCommand.js";
import {
  parseAliasMetaCommand,
  parseAliasOpenCommand,
  type AliasIntent,
} from "./parseAliasCommand.js";
import {
  parseFileOperationCommand,
  type FileOpIntent,
} from "./parseFileOperationCommand.js";
import { parseNativeAppCommand, type NativeAppIntent } from "./parseNativeAppCommand.js";
import {
  parseSystemActionCommand,
  type SystemActionIntent,
} from "./parseSystemActionCommand.js";
import {
  parseSessionMemoryCommand,
  type SessionMemoryIntent,
} from "./parseSessionMemoryCommand.js";
import {
  parseWorkspaceMetaCommand,
  parseWorkspaceOpenCommand,
  type WorkspaceIntent,
} from "./parseWorkspaceCommand.js";
import {
  parseWorkflowMetaCommand,
  parseWorkflowRunCommand,
  type WorkflowIntent,
} from "./parseWorkflowCommand.js";

export type NativeCommandIntent =
  | DesktopOpenIntent
  | NativeAppIntent
  | SystemActionIntent
  | SessionMemoryIntent
  | AliasIntent
  | FileOpIntent
  | WorkspaceIntent
  | WorkflowIntent;

/**
 * Unified local desktop parser.
 * Order: workflow meta -> alias meta -> workspace meta -> workflow run ->
 *        alias open -> workspace open -> file ops -> apps -> folders/files.
 */
export function parseNativeCommand(
  command?: string | null,
): NativeCommandIntent | null {
  const workflowMeta = parseWorkflowMetaCommand(command);
  if (workflowMeta) return workflowMeta;

  const aliasMeta = parseAliasMetaCommand(command);
  if (aliasMeta) return aliasMeta;

  const workspaceMeta = parseWorkspaceMetaCommand(command);
  if (workspaceMeta) return workspaceMeta;

  const workflowRun = parseWorkflowRunCommand(command);
  if (workflowRun) return workflowRun;

  const sessionRecall = parseSessionMemoryCommand(command);
  if (sessionRecall) return sessionRecall;

  const aliasOpen = parseAliasOpenCommand(command);
  if (aliasOpen) return aliasOpen;

  const workspaceOpen = parseWorkspaceOpenCommand(command);
  if (workspaceOpen) return workspaceOpen;

  const fileOp = parseFileOperationCommand(command);
  if (fileOp) return fileOp;

  const systemAction = parseSystemActionCommand(command);
  if (systemAction) return systemAction;

  const app = parseNativeAppCommand(command);
  if (app) return app;

  return parseDesktopCommand(command);
}

export function isNativeCommand(command?: string | null): boolean {
  return parseNativeCommand(command) !== null;
}
