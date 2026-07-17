import type { DesktopInputParsed, WorldModel } from "../types.js";
import { runCompoundPlanner, tryL0CompoundPlan } from "./l0CompoundPlanner.js";
import type { ExecutionPlan, L0PlannerResult, PlanStep } from "./planTypes.js";
import {
  isGmailComposeFocused,
  isInstagramTabActive,
  isLinkedInTabActive,
  isNotionFocused,
  isWhatsAppTabActive,
  isYouTubeFocused,
} from "../../focus/focusContext.js";
import {
  extractDirectTypingText,
  isCalculatorForeground,
  isComposeTopicOnlyCommand,
  isExplorerForeground,
  isPasteClipboardCommand,
  parseCalculatorInput,
  parseDesktopInputFallback,
} from "../parseDesktopInput.js";
import { parseNativeCommandStrict, type NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import { parseFileOperationCommand } from "../../automation/desktop/parseFileOperationCommand.js";
import { parseWellKnownFolderOpen } from "../../automation/desktop/folderIntent.js";
import { buildDesktopCommandResult, commandPayloadFromIntent } from "../../automation/desktop/desktopCommand.js";
import { filesystemPlanFromDesktopPayload } from "./desktopPayloadToFilesystem.js";
import { lookupBinding } from "./plannerMemory.js";
import { resolveAppPhrase } from "./entityResolver.js";
import {
  isDesktopOpenIntent,
  isFileOpIntent,
  planFromFileOpIntent,
  planFromOpenIntent,
} from "./l0FileOpPlanner.js";

import {
  parseListDirectoryCommand,
  planFromListDirectory,
} from "./l0ListDirectory.js";
import {
  parseCreateFileInAppCommand,
  type CreateFileInAppIntent,
} from "../../automation/desktop/parseCreateFileInAppCommand.js";
import {
  planStepsForCreateFileInApp,
} from "./planCreateFileInApp.js";
import { firstCompoundClause } from "../../automation/voice/nlu/compoundParse.js";
import { tracePlannerBranch } from "./plannerTrace.js";
import {
  classifyUtterance,
  compoundStickyEnabled,
} from "./utteranceClassifier.js";
import { tryCompoundGate } from "./compoundGate.js";
import { planFromNativeIntent } from "./planFromNativeIntent.js";
import { browserWorkspacePlanFromDesktopPayload } from "./browserWorkspacePlan.js";
import { tryL0WhatsAppPlan } from "./l0WhatsAppPlanner.js";
import { plannerV2AtomicEnabled } from "./v2/plannerV2Config.js";
import { planAtomicWithV2 } from "./v2/plannerV2.js";
import { shouldBypassP85Planner } from "./gptFallbackPolicy.js";
import { desktopPayloadNeedsLegacyBridge } from "./legacyDesktopBridge.js";

function legacyDesktopPayloadPlan(
  intent: NativeCommandIntent,
  rawCommand: string,
  normalized: string,
): ExecutionPlan | null {
  const payload = commandPayloadFromIntent(intent, rawCommand, " (p85-l0)");
  if (!desktopPayloadNeedsLegacyBridge(payload)) return null;
  return {
    goal: "Desktop workflow",
    confidence: 0.88,
    steps: [
      {
        tool: "desktop.launch_app",
        args: { _desktopPayload: payload },
        reason: "desktop_command_result",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

const OPEN_APP_FOR_MEMORY =
  /^(?:please\s+)?(?:open|launch|start)\s+(?:the\s+)?(.+?)\s*$/i;

const COMPOSE_WITH_BODY =
  /^(?:can you )?(?:please )?(?:write|compose|draft|fill(?:\s+in)?|enter)\s+(?:a\s+)?(?:professional\s+)?(?:email|message|letter|note|reply|response)?\s*(?::|saying|that says|,)\s*(.+)$/i;

const DAAL_DO =
  /^(?:please\s+)?(?:daal do|daal de|insert karo|yahan likho|idhar likho)\s+(.+)$/i;

const PASTE_LITERAL =
  /^(?:please\s+)?(?:paste|insert)\s+(?:this|here)\s*[:,]?\s+(.+)$/i;

const COPY_TO_CLIPBOARD =
  /^(?:please\s+)?(?:copy|put)\s+(.+?)\s+(?:to|on|into)\s+(?:the\s+)?clipboard\s*$/i;

const READ_CLIPBOARD =
  /^(?:please\s+)?(?:(?:read|show)\s+(?:me\s+)?(?:what(?:'s| is)\s+(?:on|in)\s+)?(?:my\s+)?clipboard|clipboard\s+(?:read|contents?))\s*$/i;

const AMBIGUOUS_SEND =
  /^(?:send|share)\s+(?:this|that|it)\s+(?:to|with)\s+(.+?)\s*$/i;

const ACTIVE_WINDOW_QUERY =
  /^\s*(?:what\s+window\s+is\s+active|which\s+app\s+(?:is\s+)?(?:open|active)|(?:what|which)\s+(?:application|app)(?:\s+currently)?\s+(?:am\s+i|i\s+am)\s+using|(?:what|which)\s+(?:application|app)\s+am\s+i\s+currently\s+using|tell\s+(?:me\s+)?(?:(?:the\s+)?active\s+window|what\s+application\s+is\s+currently\s+active)|(?:what\s+)?(?:application|app)\s+(?:am\s+i|i\s+am)\s+(?:currently\s+)?using|current\s+application|active\s+window)\s*[?.!]?\s*$/i;

const CURRENT_WORKSPACE_QUERY =
  /\b(?:explain (?:my )?current workspace|what project am i (?:on|in|working on)|which project am i (?:on|in|working on)|where am i working right now|tell me (?:my )?current project|current project|current workspace)\b/i;
function planCreateFileInApp(
  intent: CreateFileInAppIntent,
  rawCommand: string,
  normalized: string,
  world: WorldModel,
): ExecutionPlan {
  return {
    goal: `Create ${intent.filename}`,
    confidence: 0.9,
    steps: planStepsForCreateFileInApp(intent, world),
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

function isWebComposeContext(): boolean {
  return (
    isWhatsAppTabActive() ||
    isGmailComposeFocused() ||
    isInstagramTabActive() ||
    isLinkedInTabActive() ||
    isYouTubeFocused() ||
    isNotionFocused()
  );
}

function shouldDeferWebCompose(normalized: string): boolean {
  if (!isWebComposeContext()) return false;
  if (parseDesktopInputFallback(normalized)) return false;
  if (isComposeTopicOnlyCommand(normalized)) return false;
  // In Gmail/WhatsApp compose surfaces, only defer compose-like utterances — not unknown text.
  return /^\s*(?:write|type|compose|draft|reply|enter|say|put)\b/i.test(normalized);
}

function withExplorerPrefocus(
  parsed: DesktopInputParsed,
  world?: WorldModel | null,
): DesktopInputParsed {
  if (parsed.mode !== "text" || !isExplorerForeground(world)) return parsed;
  return { ...parsed, prefocusKeys: "^e" };
}

export function parsedToPlanSteps(parsed: DesktopInputParsed): PlanStep[] {
  switch (parsed.mode) {
    case "text":
      return [
        {
          tool: "desktop.type_text",
          args: {
            text: parsed.text,
            ...(parsed.replaceAll ? { replaceAll: true } : {}),
            ...(parsed.prefocusKeys ? { prefocusKeys: parsed.prefocusKeys } : {}),
          },
          reason: "type_text",
        },
      ];
    case "keys": {
      if (parsed.keys === "^c") {
        return [{ tool: "desktop.copy", args: {}, reason: "copy" }];
      }
      if (parsed.keys === "^v") {
        return [{ tool: "desktop.paste", args: {}, reason: "paste" }];
      }
      if (parsed.keys === "^a") {
        return [{ tool: "desktop.select_all", args: {}, reason: "select_all" }];
      }
      return [
        {
          tool: "desktop.press_keys",
          args: { keys: parsed.keys },
          reason: "press_keys",
        },
      ];
    }
    case "sequence":
      return [
        {
          tool: "desktop.press_keys",
          args: { sequence: parsed.sequence },
          reason: "key_sequence",
        },
      ];
    case "mouse": {
      if (parsed.action === "move") {
        return [
          {
            tool: "desktop.mouse_move",
            args: {
              deltaX: parsed.deltaX ?? 0,
              deltaY: parsed.deltaY ?? 0,
            },
            reason: "mouse_move",
          },
        ];
      }
      if (parsed.action === "move_to_center") {
        return [
          {
            tool: "desktop.mouse_move",
            args: { moveToCenter: true },
            reason: "mouse_center",
          },
        ];
      }
      if (parsed.action === "click" || parsed.action === "double_click") {
        return [
          {
            tool: "desktop.mouse_click",
            args: { double: parsed.action === "double_click" },
            reason: parsed.action,
          },
        ];
      }
      if (parsed.action === "scroll_up" || parsed.action === "scroll_down") {
        return [
          {
            tool: "desktop.press_keys",
            args: {
              keys: parsed.action === "scroll_up" ? "{PGUP}" : "{PGDN}",
            },
            reason: parsed.action,
          },
        ];
      }
      return [];
    }
    default:
      return [];
  }
}

function planFromParsed(
  parsed: DesktopInputParsed,
  raw: string,
  normalized: string,
  goal: string,
  confidence: number,
  reason: string,
): ExecutionPlan {
  return {
    goal,
    confidence,
    steps: parsedToPlanSteps(parsed),
    rawUtterance: raw,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

export type { L0PlannerResult } from "./planTypes.js";

/**
 * Atomic-only L0 — full-string parsers; never entered when compound sticky gate is active.
 */
export function runAtomicPlanner(
  rawCommand: string,
  normalized: string,
  world: WorldModel,
): L0PlannerResult {
  const raw = normalized;
  const whatsappPlan = tryL0WhatsAppPlan(rawCommand, normalized);
  if (whatsappPlan) {
    tracePlannerBranch("atomic", "whatsapp_tool", "full");
    return whatsappPlan;
  }
  if (shouldBypassP85Planner(rawCommand)) {
    return { kind: "defer", reason: "adapter_owned" };
  }
  tracePlannerBranch("atomic", "runAtomicPlanner", "full");

  const parsed = parseDesktopInputFallback(raw);
  if (parsed) {
    const withPrefocus = withExplorerPrefocus(parsed, world);
    return {
      kind: "plan",
      plan: planFromParsed(
        withPrefocus,
        rawCommand,
        normalized,
        "Desktop input",
        0.95,
        "desktop_input_parser",
      ),
    };
  }

  if (ACTIVE_WINDOW_QUERY.test(raw)) {
    return {
      kind: "plan",
      plan: {
        goal: "Get active window",
        confidence: 0.95,
        steps: [
          {
            tool: "desktop.get_active_window",
            args: {},
            reason: "active_window",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (CURRENT_WORKSPACE_QUERY.test(raw) || CURRENT_WORKSPACE_QUERY.test(normalized)) {
    return {
      kind: "plan",
      plan: {
        goal: "Get current live workspace",
        confidence: 0.94,
        steps: [
          {
            tool: "desktop.get_current_workspace",
            args: {},
            reason: "current_workspace_live_context",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const createInApp =
    parseCreateFileInAppCommand(rawCommand) ??
    parseCreateFileInAppCommand(raw);
  if (createInApp) {
    return {
      kind: "plan",
      plan: planCreateFileInApp(createInApp, rawCommand, normalized, world),
    };
  }

  const listDir = parseListDirectoryCommand(raw);
  if (listDir) {
    return {
      kind: "plan",
      plan: planFromListDirectory(
        listDir.parentFolder,
        rawCommand,
        normalized,
      ),
    };
  }

  const daal = raw.match(DAAL_DO);
  if (daal?.[1]?.trim()) {
    return {
      kind: "plan",
      plan: planFromParsed(
        { mode: "text", text: daal[1].trim() },
        rawCommand,
        normalized,
        "Insert text",
        0.9,
        "hinglish_daal_do",
      ),
    };
  }

  if (isPasteClipboardCommand(raw.toLowerCase().replace(/[,\s]+/g, " ").trim())) {
    return {
      kind: "plan",
      plan: {
        goal: "Paste clipboard",
        confidence: 0.92,
        steps: [{ tool: "desktop.paste", args: {}, reason: "paste_clipboard" }],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (READ_CLIPBOARD.test(raw)) {
    return {
      kind: "plan",
      plan: {
        goal: "Read clipboard",
        confidence: 0.92,
        steps: [
          {
            tool: "system.clipboard.read",
            args: {},
            reason: "read_clipboard",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const copyToClipboard = raw.match(COPY_TO_CLIPBOARD);
  if (copyToClipboard?.[1]?.trim()) {
    return {
      kind: "plan",
      plan: {
        goal: "Copy to clipboard",
        confidence: 0.9,
        steps: [
          {
            tool: "system.clipboard.write",
            args: { text: copyToClipboard[1].trim() },
            reason: "write_clipboard",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const pasteLiteral = raw.match(PASTE_LITERAL);
  if (pasteLiteral?.[1]?.trim()) {
    return {
      kind: "plan",
      plan: planFromParsed(
        { mode: "text", text: pasteLiteral[1].trim() },
        rawCommand,
        normalized,
        "Paste literal text",
        0.88,
        "paste_literal_text",
      ),
    };
  }

  if (
    world.clipboard.hasText &&
    /^(?:paste|insert)\s+(?:clipboard|copied|what i copied)\s*$/i.test(raw)
  ) {
    return {
      kind: "plan",
      plan: {
        goal: "Paste clipboard",
        confidence: 0.9,
        steps: [{ tool: "desktop.paste", args: {}, reason: "paste_clipboard" }],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const directText = extractDirectTypingText(raw);
  if (directText) {
    return {
      kind: "plan",
      plan: planFromParsed(
        withExplorerPrefocus({ mode: "text", text: directText }, world),
        rawCommand,
        normalized,
        "Type text",
        0.95,
        "extract_direct_typing",
      ),
    };
  }

  const openForMemory = raw.match(OPEN_APP_FOR_MEMORY);
  if (openForMemory?.[1]) {
    const phrase = firstCompoundClause(openForMemory[1].trim());
    const binding = lookupBinding(phrase);
    if (binding?.kind === "app") {
      const app = resolveAppPhrase(phrase);
      if (app) {
        return {
          kind: "plan",
          plan: {
            goal: `Open ${app.id}`,
            confidence: 0.93,
            steps: [
              {
                tool: "desktop.launch_app",
                args: {
                  app: app.id,
                  _nativeIntent: { kind: "launch_app", app },
                },
                reason: "planner_memory_app",
              },
            ],
            rawUtterance: rawCommand,
            normalizedUtterance: normalized,
            source: "L0",
          },
        };
      }
    }
  }

  const folderOpenEarly = parseWellKnownFolderOpen(raw);
  if (folderOpenEarly) {
    return {
      kind: "plan",
      plan: planFromOpenIntent(folderOpenEarly, rawCommand, normalized),
    };
  }

  if (plannerV2AtomicEnabled()) {
    const v2Atomic = planAtomicWithV2(rawCommand, normalized);
    if (v2Atomic?.kind === "plan") {
      tracePlannerBranch("l0", "planner_v2_atomic", "full", v2Atomic.plan.steps.map((s) => s.tool).join(","));
      return { kind: "plan", plan: v2Atomic.plan };
    }
    if (v2Atomic?.kind === "clarify") {
      return {
        kind: "clarify",
        question: v2Atomic.question,
        confidence: 0.5,
        reason: "planner_v2_atomic_clarify",
      };
    }
    // null → fall through to L0 parsers (file ops, native strict, etc.)
  }

  const strict = parseNativeCommandStrict(raw);
  if (strict) {
    if (isFileOpIntent(strict)) {
      return {
        kind: "plan",
        plan: planFromFileOpIntent(strict, rawCommand, normalized),
      };
    }
    if (isDesktopOpenIntent(strict)) {
      return {
        kind: "plan",
        plan: planFromOpenIntent(strict, rawCommand, normalized),
      };
    }
    const legacyPlan = legacyDesktopPayloadPlan(strict, rawCommand, normalized);
    if (legacyPlan) {
      return { kind: "plan", plan: legacyPlan };
    }
    const nativePlan = planFromNativeIntent(strict, rawCommand, normalized, {
      goal: `Desktop: ${strict.kind}`,
      confidence: 0.9,
      reason: "native_strict",
    });
    if (nativePlan) {
      return { kind: "plan", plan: nativePlan };
    }
  }

  const fileOp = parseFileOperationCommand(raw);
  if (fileOp) {
    return {
      kind: "plan",
      plan: planFromFileOpIntent(fileOp, rawCommand, normalized),
    };
  }

  const compoundBlock = tryCompoundGate(rawCommand, normalized);
  if (compoundBlock?.kind === "clarify") {
    return {
      kind: "clarify",
      question: compoundBlock.question,
      confidence: compoundBlock.confidence,
      reason: compoundBlock.reason,
    };
  }
  if (compoundBlock?.kind === "partial") {
    return {
      kind: "partial",
      plan: compoundBlock.plan,
      unresolvedClauses: compoundBlock.unresolvedClauses,
      splitPreview: compoundBlock.splitPreview,
      question: compoundBlock.question,
      confidence: compoundBlock.confidence,
      reason: compoundBlock.reason,
    };
  }

  const desktop = buildDesktopCommandResult(raw);
  if (desktop?.actions?.length) {
    const fsPlan = filesystemPlanFromDesktopPayload(
      desktop,
      rawCommand,
      normalized,
    );
    if (fsPlan) {
      return { kind: "plan", plan: fsPlan };
    }
    if (!plannerV2AtomicEnabled() || desktopPayloadNeedsLegacyBridge(desktop)) {
      const browserPlan = browserWorkspacePlanFromDesktopPayload(
        desktop,
        rawCommand,
        normalized,
      );
      if (browserPlan) {
        return { kind: "plan", plan: browserPlan };
      }
      return {
        kind: "plan",
        plan: {
          goal: "Desktop workflow",
          confidence: 0.88,
          steps: [
            {
              tool: "desktop.launch_app",
              args: { _desktopPayload: desktop },
              reason: "desktop_command_result",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
  }

  if (shouldDeferWebCompose(raw)) {
    return { kind: "defer", reason: "web_adapter_compose" };
  }

  return { kind: "defer", reason: "no_l0_match" };
}

/**
 * P8.5 L0 — classify → compound | atomic planners.
 */
export function runL0Planner(
  rawCommand: string,
  normalized: string,
  world: WorldModel,
): L0PlannerResult {
  const raw = normalized;
  if (!raw) return { kind: "defer", reason: "empty" };

  const whatsappPlan = tryL0WhatsAppPlan(rawCommand, normalized);
  if (whatsappPlan) {
    tracePlannerBranch("l0", "whatsapp_tool", "full");
    return whatsappPlan;
  }

  if (shouldBypassP85Planner(rawCommand)) {
    tracePlannerBranch("l0", "adapter_owned", "full");
    return { kind: "defer", reason: "adapter_owned" };
  }

  if (isCalculatorForeground(world)) {
    const calc = parseCalculatorInput(raw);
    if (calc) {
      tracePlannerBranch("l0", "A2_calculator", "full");
      return {
        kind: "plan",
        plan: planFromParsed(
          calc,
          rawCommand,
          normalized,
          "Calculator input",
          0.93,
          "calculator_input",
        ),
      };
    }
  }

  const ambiguousSend = raw.match(AMBIGUOUS_SEND);
  if (ambiguousSend?.[1]) {
    const name = ambiguousSend[1].trim();
    if (name.split(/\s+/).length <= 2 && !/\b(?:gmail|email|whatsapp)\b/i.test(name)) {
      tracePlannerBranch("l0", "A3_ambiguous_send", "full");
      return {
        kind: "clarify",
        question: `Which ${name} did you mean?`,
        options: [`${name} from contacts`, "Someone else"],
        confidence: 0.4,
        reason: "ambiguous_recipient",
      };
    }
  }

  const composeBody = raw.match(COMPOSE_WITH_BODY);
  if (composeBody?.[1]?.trim()) {
    tracePlannerBranch("l0", "A4_compose_body", "full");
    return {
      kind: "plan",
      plan: planFromParsed(
        { mode: "text", text: composeBody[1].trim() },
        rawCommand,
        normalized,
        "Compose text",
        0.92,
        "compose_with_explicit_body",
      ),
    };
  }

  if (isComposeTopicOnlyCommand(raw)) {
    tracePlannerBranch("l0", "A5_compose_topic", "full");
    return { kind: "defer", reason: "compose_needs_llm" };
  }

  const utteranceClass = classifyUtterance(rawCommand, normalized);
  tracePlannerBranch("l0", `classify_${utteranceClass}`, "full");

  if (utteranceClass === "compound") {
    const compoundResult = runCompoundPlanner(rawCommand, normalized);
    if (compoundResult.kind === "partial") {
      return compoundResult;
    }
    if (compoundResult.kind !== "defer" || compoundResult.reason !== "compound_legacy_fallthrough") {
      return compoundResult;
    }
    const legacyCompound = tryL0CompoundPlan(rawCommand, normalized);
    if (legacyCompound) {
      return { kind: "plan", plan: legacyCompound };
    }
  }

  return runAtomicPlanner(rawCommand, normalized, world);
}
