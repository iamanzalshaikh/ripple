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
import {
  parseSmartSearchCommand,
  type SmartSearchIntent,
} from "./parseSmartSearchCommand.js";
import { parseUndoCommand, type UndoCommandIntent } from "./parseUndoCommand.js";
import { parseGraphOpenCommand } from "./parseGraphOpenCommand.js";
import { parseGmailOpenEmailCommand } from "../gmail/parseGmailOpenEmail.js";
import type { CompoundIntent } from "../voice/nlu/compoundParse.js";
import type { ReferentialSendIntent } from "../voice/nlu/parseReferentialWhatsApp.js";
import type { RememberLifeEventIntent } from "../retriever/parseSemanticOpen.js";
import type { GmailOpenEmailIntent } from "../gmail/parseGmailOpenEmail.js";
import type { OpenCrossAppAttachmentIntent } from "../gmail/parseOpenCrossAppAttachment.js";
import { parseSaveFileCommand, type SaveFileIntent } from "./parseSaveFileCommand.js";
import { parseCreateFileInAppCommand } from "./parseCreateFileInAppCommand.js";
import { parseReferentialSend } from "../voice/nlu/parseReferentialWhatsApp.js";
import { parseDesktopIntent } from "../voice/nlu/pipeline.js";
import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import {
  parseBrowserWorkspaceSearch,
  type BrowserSearchIntent,
} from "../browser/parseBrowserWorkspaceSearch.js";

export type { BrowserSearchIntent };

export type OpenResolvedIntent = { kind: "open_resolved"; path: string };

export type TypeTextIntent = {
  kind: "type_text";
  text?: string;
  keys?: string;
  sequence?: Array<{ value: string; delayMs?: number }>;
  replaceAll?: boolean;
};

export type NativeCommandIntent =
  | DesktopOpenIntent
  | NativeAppIntent
  | SystemActionIntent
  | SessionMemoryIntent
  | AliasIntent
  | FileOpIntent
  | WorkspaceIntent
  | WorkflowIntent
  | SmartSearchIntent
  | UndoCommandIntent
  | OpenResolvedIntent
  | ReferentialSendIntent
  | CompoundIntent
  | RememberLifeEventIntent
  | GmailOpenEmailIntent
  | OpenCrossAppAttachmentIntent
  | SaveFileIntent
  | CreateFileInAppIntent
  | TypeTextIntent
  | BrowserSearchIntent;

/**
 * Strict regex parsers only — no NLU fallback.
 */
export function parseNativeCommandStrict(
  command?: string | null,
): NativeCommandIntent | null {
  const undo = parseUndoCommand(command);
  if (undo) return undo;

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

  const cmd = normalizeTranscript(command ?? "");
  if (/^\s*open\s+(?:move|rename|delete|send|copy)\b/i.test(cmd)) {
    const fileOpAfterOpen = parseFileOperationCommand(
      cmd.replace(/^\s*open\s+/i, ""),
    );
    if (fileOpAfterOpen) return fileOpAfterOpen;
  }

  const aliasOpen = parseAliasOpenCommand(command);
  if (aliasOpen) return aliasOpen;

  const gmailEmail = parseGmailOpenEmailCommand(command);
  if (gmailEmail) return gmailEmail;

  const graphOpen = parseGraphOpenCommand(command);
  if (graphOpen) return graphOpen;

  const referentialSend = parseReferentialSend(command);
  if (referentialSend) return referentialSend;

  const createInApp = parseCreateFileInAppCommand(command);
  if (createInApp) return createInApp;

  const fileOp = parseFileOperationCommand(command);
  if (fileOp) return fileOp;

  const systemAction = parseSystemActionCommand(command);
  if (systemAction) return systemAction;

  const app = parseNativeAppCommand(command);
  if (app) return app;

  const browserSearch = parseBrowserWorkspaceSearch(command);
  if (browserSearch) return browserSearch;

  const smartSearch = parseSmartSearchCommand(command);
  if (smartSearch) return smartSearch;

  const desktopOpen = parseDesktopCommand(command);
  if (desktopOpen) return desktopOpen;

  // Keep alias/workspace open late so they do not shadow canonical desktop folders
  // (e.g. "open downloads") or smart_search intents (e.g. "open my resume").
  const workspaceOpen = parseWorkspaceOpenCommand(command);
  if (workspaceOpen) return workspaceOpen;

  return null;
}

/**
 * Unified local desktop parser (Phase 4.6).
 * Same entry as pipeline — includes compound + NLU fallback.
 */
export function parseNativeCommand(
  command?: string | null,
): NativeCommandIntent | null {
  return parseDesktopIntent(command)?.intent ?? null;
}

export function isNativeCommand(command?: string | null): boolean {
  return parseNativeCommand(command) !== null;
}
