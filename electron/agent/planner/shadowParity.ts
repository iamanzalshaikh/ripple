import type { CommandResultPayload } from "../../automation/types.js";
import { buildDesktopCommandResult } from "../../automation/desktop/desktopCommand.js";
import { normalizeFolderKey } from "../../automation/desktop/folderIntent.js";
import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import {
  normalizeDesktopVoiceCommand,
  parseDesktopInputFallback,
} from "../parseDesktopInput.js";
import { buildTypingPayloadFromInput } from "../typingPayload.js";
import type { ExecutionPlan } from "./planTypes.js";
import {
  executionPlanToPayload,
  insertDataFromPlanStep,
} from "./executionPlanToPayload.js";
import { isPlannerShadowMode, logPlannerRouterMismatch } from "./planLogger.js";
import { recordRouterMismatch } from "./routerParity.js";

const ADAPTER_TOOL_PREFIXES = [
  "browser.whatsapp.",
  "browser.youtube.",
  "browser.gmail.",
  "browser.linkedin.",
  "browser.instagram.",
  "browser.notion.",
];

const P85_EXTENSION_REASONS = new Set([
  "create_file_cursor",
  "create_file_in_app",
]);

const P85_EXTENSION_TOOLS = new Set([
  "filesystem.search",
  "filesystem.read_file",
  "filesystem.list_directory",
  "filesystem.get_metadata",
  "filesystem.write_file",
  "filesystem.patch_file",
  "browser.open_url",
  "browser.extract_text",
  "browser.find_element",
  "browser.click",
  "browser.type",
  "browser.scroll",
  "automation.open_project",
  "automation.find_code",
  "automation.scan_project",
  "automation.analyze_codebase",
  "automation.typecheck",
  "automation.lint",
]);

function planUsesAdapterTools(plan: ExecutionPlan): boolean {
  return plan.steps.some((s) =>
    ADAPTER_TOOL_PREFIXES.some((p) => s.tool.startsWith(p)),
  );
}

/** P8.5 capabilities that intentionally diverge from legacy desktop-fast/input. */
export function planUsesP85ExtensionTools(plan: ExecutionPlan): boolean {
  if (plan.steps.some((s) => P85_EXTENSION_REASONS.has(s.reason ?? ""))) {
    return true;
  }
  return plan.steps.some((s) => P85_EXTENSION_TOOLS.has(s.tool));
}

function isMeaninglessLegacyNoop(signature: string): boolean {
  if (!signature.startsWith("NOOP:")) return false;
  const data = signature.slice(5);
  if (data === "{}") return true;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    return Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

/** Legacy router produced only empty NOOP placeholders — nothing to compare. */
export function isLegacyNoopOnly(payload: CommandResultPayload): boolean {
  const sigs = payloadActionSignatures(payload);
  return sigs.length > 0 && sigs.every(isMeaninglessLegacyNoop);
}

export type LegacyRouterKind = "desktop-input" | "desktop-fast" | "none";

export type ShadowParityResult = {
  matched: boolean;
  legacyRouter: LegacyRouterKind;
  reason?: string;
  p85Signature: string[];
  legacySignature: string[];
};

/** P8.5 Phase 3 — compare planner/executor path vs legacy desktop routers. */
export function isShadowParityCompareEnabled(): boolean {
  if (process.env.RIPPLE_P85_SHADOW_COMPARE === "0") return false;
  if (process.env.RIPPLE_P85_SHADOW_COMPARE === "1") return true;
  return false;
}

export function resolveLegacyDesktopPayload(command: string): {
  router: Exclude<LegacyRouterKind, "none">;
  payload: CommandResultPayload;
} | null {
  const normalized = normalizeDesktopVoiceCommand(command);
  const parsed =
    parseDesktopInputFallback(normalized) ?? parseDesktopInputFallback(command);
  if (parsed) {
    return {
      router: "desktop-input",
      payload: buildTypingPayloadFromInput(command, parsed),
    };
  }

  const desktop = buildDesktopCommandResult(command);
  if (desktop?.actions?.length) {
    return { router: "desktop-fast", payload: desktop };
  }

  return null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function normalizeInsertData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof data.text === "string") out.text = data.text.trim();
  if (typeof data.keys === "string") out.keys = data.keys.trim();
  if (Array.isArray(data.sequence)) out.sequence = data.sequence;
  if (data.replaceAll === true) out.replaceAll = true;
  if (typeof data.prefocusKeys === "string") {
    out.prefocusKeys = data.prefocusKeys.trim();
  }
  if (typeof data.mouseAction === "string") {
    out.mouseAction = data.mouseAction;
  }
  if (typeof data.deltaX === "number") out.deltaX = data.deltaX;
  if (typeof data.deltaY === "number") out.deltaY = data.deltaY;
  if (typeof data.x === "number") out.x = data.x;
  if (typeof data.y === "number") out.y = data.y;
  if (typeof data.desktopKind === "string") {
    out.desktopKind = data.desktopKind;
  }
  if (typeof data.appId === "string") out.appId = data.appId;
  if (typeof data.folder === "string") out.folder = data.folder;
  if (typeof data.filename === "string") out.filename = data.filename;
  if (typeof data.itemName === "string") out.itemName = data.itemName;
  if (typeof data.parentFolder === "string") {
    out.parentFolder = data.parentFolder;
  }
  if (typeof data.filename === "string") out.filename = data.filename;
  if (typeof data.folder === "string") out.folder = data.folder;
  if (typeof data.path === "string") out.path = data.path;
  if (typeof data.aliasName === "string") out.aliasName = data.aliasName;
  if (typeof data.aliasType === "string") out.aliasType = data.aliasType;
  return out;
}

function nativeIntentSignature(intent: NativeCommandIntent): string {
  switch (intent.kind) {
    case "launch_app":
      return `launch_app:${intent.app.id}`;
    case "switch_app":
      return `switch_app:${intent.app.id}`;
    case "close_app":
      return `close_app:${intent.app.id}`;
    case "folder":
      return `folder:${intent.folder}`;
    case "file":
      return `file:${intent.filename}`;
    case "item":
      return intent.parent
        ? `item:${intent.name}@${intent.parent}`
        : `item:${intent.name}`;
    case "type_text":
      if (intent.text) return `type_text:${intent.text.trim()}`;
      if (intent.keys) return `keys:${intent.keys}`;
      return `sequence:${stableJson(intent.sequence ?? [])}`;
    case "open_resolved":
      return `open_resolved:${intent.path}`;
    case "open_workspace":
      return `open_workspace:${intent.workspace.id}`;
    case "browser_search":
      return `browser_search:${intent.query}`;
    default:
      return `${intent.kind}`;
  }
}

function payloadActionSignatures(payload: CommandResultPayload): string[] {
  const out: string[] = [];
  for (const action of payload.actions ?? []) {
    if (action.type === "WORKFLOW") {
      const steps =
        (
          action.data as {
            steps?: Array<{ type: string; data?: Record<string, unknown> }>;
          }
        )?.steps ?? [];
      for (const step of steps) {
        const data = normalizeInsertData(step.data ?? {});
        if (data.desktopKind) {
          out.push(`${step.type}:${stableJson(data)}`);
        } else {
          out.push(`${step.type}:${stableJson(data)}`);
        }
      }
      continue;
    }

    const data = normalizeInsertData(
      (action.data ?? {}) as Record<string, unknown>,
    );
    if (data.desktopKind) {
      out.push(`${action.type}:${stableJson(data)}`);
    } else {
      out.push(`${action.type}:${stableJson(data)}`);
    }
  }
  return out;
}

function planStepSignatures(plan: ExecutionPlan, command: string): string[] {
  const firstTool = plan.steps[0]?.tool ?? "";
  const usePayloadBridge =
    plan.steps.length === 1 &&
    !firstTool.startsWith("filesystem.") &&
    !firstTool.startsWith("system.");

  if (usePayloadBridge) {
    const bridged = executionPlanToPayload(plan, command);
    if (bridged?.actions?.length) {
      return payloadActionSignatures(bridged);
    }
  }

  return plan.steps.map((step) => {
    const insert = insertDataFromPlanStep(step);
    if (insert) {
      return `${step.tool}:${stableJson(normalizeInsertData(insert))}`;
    }
    if (step.args._nativeIntent) {
      return `${step.tool}:${nativeIntentSignature(step.args._nativeIntent as NativeCommandIntent)}`;
    }
    if (step.args._desktopPayload) {
      const legacy = step.args._desktopPayload as CommandResultPayload;
      return `${step.tool}:${payloadActionSignatures(legacy).join("|")}`;
    }
    if (typeof step.args.app === "string") {
      return `${step.tool}:app:${step.args.app.trim().toLowerCase()}`;
    }
    if (step.tool.startsWith("filesystem.")) {
      const args = { ...step.args } as Record<string, unknown>;
      delete args._nativeIntent;
      delete args._desktopPayload;
      return `${step.tool}:${stableJson(normalizeInsertData(args))}`;
    }
    if (step.tool === "desktop.save_file") {
      const args = { ...step.args } as Record<string, unknown>;
      return `${step.tool}:${stableJson(normalizeInsertData(args))}`;
    }
    return step.tool;
  });
}

function signaturesCompatible(
  p85: string[],
  legacy: string[],
): { matched: boolean; reason?: string } {
  if (p85.length === 0 || legacy.length === 0) {
    return { matched: false, reason: "empty_signature" };
  }
  if (p85.length !== legacy.length) {
    return { matched: false, reason: "step_count_mismatch" };
  }
  for (let i = 0; i < p85.length; i++) {
    if (p85[i] === legacy[i]) continue;

    const p85Launch = p85[i]?.match(/^desktop\.launch_app:launch_app:(.+)$/);
    const legacyLaunch = legacy[i]?.match(/^NOOP:(.+)$/);
    if (p85Launch && legacyLaunch) {
      const p85Data = JSON.parse(legacyLaunch[1]!) as Record<string, unknown>;
      if (
        p85Data.desktopKind === "launch_app" &&
        p85Data.appId === p85Launch[1]
      ) {
        continue;
      }
    }

    const p85Fs = p85[i]?.match(/^filesystem\.open:(.+)$/);
    if (p85Fs && legacy[i]?.startsWith("NOOP:")) {
      const fsArgs = JSON.parse(p85Fs[1]!) as Record<string, unknown>;
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      if (
        legacyData.desktopKind === "folder" &&
        typeof fsArgs.folder === "string" &&
        legacyData.folder === fsArgs.folder
      ) {
        continue;
      }
      if (
        legacyData.desktopKind === "open_alias" &&
        legacyData.aliasType === "folder" &&
        typeof fsArgs.folder === "string"
      ) {
        const aliasKey = String(legacyData.aliasName ?? "").toLowerCase();
        if (
          aliasKey === fsArgs.folder ||
          normalizeFolderKey(aliasKey) === fsArgs.folder
        ) {
          continue;
        }
      }
      if (
        legacyData.desktopKind === "file" &&
        typeof fsArgs.fileName === "string" &&
        legacyData.filename === fsArgs.fileName
      ) {
        continue;
      }
      if (
        legacyData.desktopKind === "item" &&
        typeof fsArgs.itemName === "string" &&
        legacyData.itemName === fsArgs.itemName &&
        (fsArgs.parentFolder === undefined ||
          legacyData.parentFolder === fsArgs.parentFolder)
      ) {
        continue;
      }
    }

    const p85FsMutator = p85[i]?.match(/^(filesystem\.\w+):(.+)$/);
    if (p85FsMutator && legacy[i]?.startsWith("NOOP:")) {
      const fsArgs = JSON.parse(p85FsMutator[2]!) as Record<string, unknown>;
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      const kindMap: Record<string, string> = {
        "filesystem.delete": "delete_file",
        "filesystem.create": "create_file",
        "filesystem.create_file": "create_file",
        "filesystem.create_folder": "create_folder",
        "filesystem.rename": "rename_file",
        "filesystem.move": "move_file",
        "filesystem.move_file": "move_file",
        "filesystem.write_file": "write_file",
        "filesystem.patch_file": "patch_file",
      };
      const expectedKind = kindMap[p85FsMutator[1]!];
      if (expectedKind && legacyData.desktopKind === expectedKind) {
        const keys = [
          "sourceName",
          "fileName",
          "folderName",
          "newName",
          "destinationFolder",
          "parentFolder",
        ];
        const fsNorm = keys.reduce(
          (acc, k) => {
            if (fsArgs[k] !== undefined) acc[k] = fsArgs[k];
            return acc;
          },
          {} as Record<string, unknown>,
        );
        const legNorm = keys.reduce(
          (acc, k) => {
            if (legacyData[k] !== undefined) acc[k] = legacyData[k];
            return acc;
          },
          {} as Record<string, unknown>,
        );
        if (stableJson(fsNorm) === stableJson(legNorm)) {
          continue;
        }
      }
    }

    const p85BrowserWorkspace = p85[i]?.match(/^browser\.open_workspace:(.+)$/);
    if (p85BrowserWorkspace && legacy[i]?.startsWith("NOOP:")) {
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      if (
        legacyData.desktopKind === "open_workspace" &&
        legacyData.workspaceId === p85BrowserWorkspace[1]
      ) {
        continue;
      }
    }

    const p85Focus = p85[i]?.match(/^desktop\.focus_window:switch_app:(.+)$/);
    if (p85Focus && legacy[i]?.startsWith("NOOP:")) {
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      if (
        legacyData.desktopKind === "switch_app" &&
        legacyData.appId === p85Focus[1]
      ) {
        continue;
      }
    }

    const p85BrowserSearch = p85[i]?.match(/^browser\.search_workspace:(.+)$/);
    if (p85BrowserSearch && legacy[i]?.startsWith("NOOP:")) {
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      if (legacyData.desktopKind === "smart_search") {
        continue;
      }
    }

    const p85WriteFile = p85[i]?.match(/^filesystem\.write_file:(.+)$/);
    if (p85WriteFile && legacy[i]?.startsWith("NOOP:")) {
      const fsArgs = JSON.parse(p85WriteFile[1]!) as Record<string, unknown>;
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      if (isMeaninglessLegacyNoop(legacy[i]!)) {
        continue;
      }
      if (
        legacyData.desktopKind === "create_file" ||
        legacyData.desktopKind === "save_file"
      ) {
        const legacyName = String(
          legacyData.filename ?? legacyData.sourceName ?? "",
        );
        const fsPath = String(fsArgs.path ?? "");
        if (legacyName && fsPath.toLowerCase().endsWith(legacyName.toLowerCase())) {
          continue;
        }
      }
    }

    const p85SaveFile = p85[i]?.match(/^desktop\.save_file:(.+)$/);
    if (p85SaveFile && legacy[i]?.startsWith("NOOP:")) {
      const saveArgs = JSON.parse(p85SaveFile[1]!) as Record<string, unknown>;
      const legacyData = JSON.parse(legacy[i]!.slice(5)!) as Record<
        string,
        unknown
      >;
      if (
        legacyData.desktopKind === "save_file" &&
        legacyData.filename === saveArgs.filename
      ) {
        continue;
      }
    }

    return { matched: false, reason: `step_${i}_mismatch` };
  }
  return { matched: true };
}

export function comparePlanToLegacyPayload(
  plan: ExecutionPlan,
  command: string,
  legacy: { router: Exclude<LegacyRouterKind, "none">; payload: CommandResultPayload },
): ShadowParityResult {
  const p85Signature = planStepSignatures(plan, command);
  const legacySignature = payloadActionSignatures(legacy.payload);
  const { matched, reason } = signaturesCompatible(
    p85Signature,
    legacySignature,
  );

  return {
    matched,
    legacyRouter: legacy.router,
    reason,
    p85Signature,
    legacySignature,
  };
}

/** After a successful P8.5 execute, verify legacy router would agree. */
export function runShadowParityOnExecute(
  command: string,
  plan: ExecutionPlan,
  p85Payload: CommandResultPayload,
): ShadowParityResult | null {
  if (!isShadowParityCompareEnabled()) return null;

  // Adapter L0 tools intentionally diverge from legacy desktop-fast NLU payloads.
  if (planUsesAdapterTools(plan)) return null;

  // P8.5 extension tools (create-file-in-cursor, filesystem intelligence) supersede legacy.
  if (planUsesP85ExtensionTools(plan)) return null;

  const legacy = resolveLegacyDesktopPayload(command);
  if (!legacy) return null;

  if (isLegacyNoopOnly(legacy.payload)) return null;

  const result = comparePlanToLegacyPayload(plan, command, legacy);
  if (!result.matched) {
    logPlannerRouterMismatch(
      command,
      result.reason ?? "shadow_execute_mismatch",
      legacy.router,
      legacy.payload,
    );
    return result;
  }

  void p85Payload;
  if (process.env.RIPPLE_P85_SHADOW === "1") {
    console.info(
      `[ripple-p85] shadow parity ok legacy=${legacy.router} ` +
        `tools=${plan.steps.map((s) => s.tool).join(",")} ` +
        `norm="${command.slice(0, 60)}"`,
    );
  }
  return result;
}

export function recordShadowParityFixturePass(command: string): void {
  const legacy = resolveLegacyDesktopPayload(command);
  if (!legacy) return;
  void legacy;
}
