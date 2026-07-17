import {
  getActiveWorkspace,
  getLastProjectPath,
} from "../../storage/workContext.js";
import { applyCorrectionsToUtterance } from "../../storage/voiceCorrections.js";
import { resolveAlias } from "../../automation/desktop/aliasRegistry.js";
import type { L0PlannerResult } from "./planTypes.js";
import { getCompoundParts } from "./utteranceClassifier.js";

const REMEMBER_USE_IDE =
  /\bremember\b(?:\s+that)?\s+(?:i\s+)?use\s+(.+?)\s+as\s+(?:my\s+)?ide\b/i;

const WHAT_IDE_USE =
  /\bwhat\s+ide\s+(?:do\s+)?i\s+use\b|\bwhat\s+ide\s+am\s+i\s+using\b/i;

const REMEMBER_AS_MAIN_PROJECT =
  /\bremember\s+(.+?)\s+as\s+(?:my\s+)?main\s+project\b/i;

const REMEMBER_MAIN_PROJECT_IS =
  /\bremember\s+(?:that\s+)?(?:my\s+)?main\s+project\s+is\s+(.+?)\s*$/i;

const OPEN_MAIN_PROJECT = /\bopen\s+(?:my\s+)?main\s+project\b/i;

const FORGET_IDE_PREF =
  /\bforget\s+(?:my\s+)?(?:ide\s+preference|preferred\s+ide)\b/i;

const LEARN_MEANS =
  /^\s*learn\s+(?:that\s+)?(.+?)\s+means\s+(.+?)\s*$/i;

const ALWAYS_PREF_IDE =
  /\b(?:always|prefer(?: to)?|default to)\b[\s\w'-]{0,40}?\b(?:open (?:projects? )?(?:in|with)|use)\s+(cursor|vscode|vs\s*code|code|antigravity(?:\s+ide)?)\b/i;

const ALWAYS_PREF_IDE_ALT =
  /\b(?:always open projects? in|preferred ide(?: is)?|set (?:my )?ide to)\s+(cursor|vscode|vs\s*code|code|antigravity(?:\s+ide)?)\b/i;

const WORK_ON =
  /^(?:please\s+)?(?:work on|set (?:active )?workspace(?: to)?|switch to(?: project)?|focus(?: on)? project)\s+(.+?)\s*$/i;

const OPEN_LAST =
  /\bopen (?:my )?(?:last|previous) (?:project|workspace)\b|\b(?:my )?(?:last|previous) (?:project|workspace)\b/i;

const FORGET =
  /\bforget\b[\s\w'-]{0,20}?\b(?:current |active |this )?(?:project|workspace|context|recent)\b/i;

const GET_PREFS =
  /\b(?:show|get|what(?:'s| is) my)\b[\s\w'-]{0,20}?\b(?:preferences?|preferred ide)\b/i;

const GET_ACTIVE_WORKSPACE =
  /\b(?:explain (?:my )?active workspace|get active workspace|active workspace|what(?:'s| is) my (?:active|main|last) project|what was i working on|what project was i (?:on|in|working on)|which project was i (?:on|in|working on))\b/i;

const CONTINUE_PREVIOUS =
  /\b(?:continue|resume)\b[\s\w'-]{0,24}?\b(?:my )?(?:previous|last|prior)\b[\s\w'-]{0,12}?\b(?:work|task|project|context)\b|\bcontinue where i (?:left off|stopped)\b|\brestore (?:my )?coding context\b/i;

const WHAT_PREVIOUS_TASK =
  /\bwhat was my (?:previous|last) task\b|\bwhat (?:was|is) my (?:previous|last) (?:task|work)\b/i;

function normalizeIdeValue(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (t.includes("cursor")) return "Cursor";
  if (t.includes("antigravity")) return "antigravity-ide";
  if (t.includes("code") || t.includes("vscode")) return "VS Code";
  return raw.trim();
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

/**
 * P6 — route preference / workspace / memory utterances.
 */
export function tryL0MemoryPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const parts = getCompoundParts(rawCommand, normalized);
  if (parts && parts.length >= 2) {
    // Allow "open my last project and …" only for the open-last fragment path via compound gate.
    if (!OPEN_LAST.test(rawCommand) && !OPEN_LAST.test(normalized)) return null;
  }

  const text = applyCorrectionsToUtterance(rawCommand.trim());
  const nrm = applyCorrectionsToUtterance(normalized.trim());

  const rememberIde =
    text.match(REMEMBER_USE_IDE) ?? nrm.match(REMEMBER_USE_IDE);
  if (rememberIde?.[1]) {
    const value = normalizeIdeValue(rememberIde[1]);
    return {
      kind: "plan",
      plan: {
        goal: `Remember preferred IDE: ${value}`,
        confidence: 0.93,
        steps: [
          {
            tool: "memory.update_preference",
            args: { key: "preferred_ide", value },
            reason: "l0_memory_remember_ide",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (WHAT_IDE_USE.test(text) || WHAT_IDE_USE.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Recall preferred IDE",
        confidence: 0.9,
        steps: [
          {
            tool: "memory.get_user_preferences",
            args: {},
            reason: "l0_memory_what_ide",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (FORGET_IDE_PREF.test(text) || FORGET_IDE_PREF.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Forget IDE preference",
        confidence: 0.9,
        steps: [
          {
            tool: "memory.update_preference",
            args: { key: "preferred_ide", value: "" },
            reason: "l0_memory_forget_ide",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const rememberMain =
    text.match(REMEMBER_AS_MAIN_PROJECT) ??
    nrm.match(REMEMBER_AS_MAIN_PROJECT) ??
    text.match(REMEMBER_MAIN_PROJECT_IS) ??
    nrm.match(REMEMBER_MAIN_PROJECT_IS);
  if (rememberMain?.[1]) {
    const hint = stripQuotes(rememberMain[1].trim());
    if (hint.length >= 1) {
      const asPath =
        /^[A-Za-z]:[\\/]/.test(hint) || hint.includes("\\") ? hint : undefined;
      return {
        kind: "plan",
        plan: {
          goal: `Remember main project: ${hint}`,
          confidence: 0.92,
          steps: [
            {
              tool: "memory.set_active_workspace",
              args: asPath
                ? { path: asPath, name: hint.split(/[\\/]/).pop() || hint }
                : { projectHint: hint, name: hint },
              reason: "l0_memory_main_project",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
  }

  if (OPEN_MAIN_PROJECT.test(text) || OPEN_MAIN_PROJECT.test(nrm)) {
    const ws = getActiveWorkspace();
    if (ws?.path) {
      return {
        kind: "plan",
        plan: {
          goal: `Open main project: ${ws.name}`,
          confidence: 0.92,
          steps: [
            {
              tool: "automation.open_project",
              args: { path: ws.path },
              reason: "l0_memory_open_main_workspace",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
    const alias =
      resolveAlias("my main project") ?? resolveAlias("main project");
    if (alias) {
      const openArgs =
        alias.type === "project" || /^[A-Za-z]:[\\/]/.test(alias.path)
          ? { path: alias.path }
          : { projectHint: alias.name };
      return {
        kind: "plan",
        plan: {
          goal: `Open main project via alias: ${alias.name}`,
          confidence: 0.88,
          steps: [
            {
              tool: "automation.open_project",
              args: openArgs,
              reason: "l0_memory_open_main_alias",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
    return {
      kind: "clarify",
      question:
        "Which project is your main project? Say remember <folder name> as my main project first.",
      confidence: 0.75,
      reason: "memory_no_main_project",
    };
  }

  const learnMeans = text.match(LEARN_MEANS) ?? nrm.match(LEARN_MEANS);
  if (learnMeans?.[1] && learnMeans?.[2]) {
    const spoken = stripQuotes(learnMeans[1].trim());
    const canonical = stripQuotes(learnMeans[2].trim());
    if (spoken.length >= 1 && canonical.length >= 1) {
      const asPath =
        /^[A-Za-z]:[\\/]/.test(canonical) || canonical.includes("\\")
          ? canonical
          : undefined;
      return {
        kind: "plan",
        plan: {
          goal: `Learn correction: ${spoken} → ${canonical}`,
          confidence: 0.91,
          steps: [
            {
              tool: "memory.learn_correction",
              args: {
                spokenForm: spoken,
                canonicalForm: canonical,
                ...(asPath ? { asAliasPath: asPath } : {}),
              },
              reason: "l0_memory_learn_means",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
  }

  const prefMatch =
    text.match(ALWAYS_PREF_IDE) ??
    text.match(ALWAYS_PREF_IDE_ALT) ??
    nrm.match(ALWAYS_PREF_IDE) ??
    nrm.match(ALWAYS_PREF_IDE_ALT);
  if (prefMatch?.[1]) {
    const value = normalizeIdeValue(prefMatch[1]);
    return {
      kind: "plan",
      plan: {
        goal: `Remember preferred IDE: ${value}`,
        confidence: 0.92,
        steps: [
          {
            tool: "memory.update_preference",
            args: { key: "preferred_ide", value },
            reason: "l0_memory_pref_ide",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (GET_PREFS.test(text) || GET_PREFS.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Show user preferences",
        confidence: 0.9,
        steps: [
          {
            tool: "memory.get_user_preferences",
            args: {},
            reason: "l0_memory_get_prefs",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (GET_ACTIVE_WORKSPACE.test(text) || GET_ACTIVE_WORKSPACE.test(nrm)) {
    const past =
      /\b(?:was i|what was i|working on|previous|last project)\b/i.test(text) ||
      /\b(?:was i|what was i|working on|previous|last project)\b/i.test(nrm);
    return {
      kind: "plan",
      plan: {
        goal: past ? "Recall recent project context" : "Show active workspace",
        confidence: 0.91,
        steps: [
          {
            tool: past
              ? "memory.get_recent_context"
              : "memory.get_active_workspace",
            args: past ? { limit: 8 } : {},
            reason: past
              ? "l0_memory_recent_project"
              : "l0_memory_get_workspace",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (WHAT_PREVIOUS_TASK.test(text) || WHAT_PREVIOUS_TASK.test(nrm)) {
    return {
      kind: "plan",
      plan: {
        goal: "Recall previous task context",
        confidence: 0.9,
        steps: [
          {
            tool: "memory.get_recent_context",
            args: { limit: 8 },
            reason: "l0_memory_previous_task",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const workOn = text.match(WORK_ON) ?? nrm.match(WORK_ON);
  if (workOn?.[1]) {
    const hint = stripQuotes(workOn[1]);
    if (hint.length >= 1) {
      return {
        kind: "plan",
        plan: {
          goal: `Set active workspace: ${hint}`,
          confidence: 0.9,
          steps: [
            {
              tool: "memory.set_active_workspace",
              args: { projectHint: hint },
              reason: "l0_memory_set_workspace",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
  }

  if (
    ((OPEN_LAST.test(text) || OPEN_LAST.test(nrm)) ||
      CONTINUE_PREVIOUS.test(text) ||
      CONTINUE_PREVIOUS.test(nrm)) &&
    !(parts && parts.length >= 2)
  ) {
    const last = getLastProjectPath();
    const continueMode =
      CONTINUE_PREVIOUS.test(text) || CONTINUE_PREVIOUS.test(nrm);
    if (!last) {
      return {
        kind: "clarify",
        question: continueMode
          ? "I don't have previous work to continue. Which project should I open?"
          : "I don't have a last project yet. Which folder should I open?",
        confidence: 0.7,
        reason: "memory_no_last_project",
      };
    }
    return {
      kind: "plan",
      plan: {
        goal: continueMode ? "Continue previous work" : "Open last project",
        confidence: 0.91,
        steps: [
          {
            tool: "automation.open_project",
            args: { path: last },
            reason: continueMode
              ? "l0_memory_continue_previous"
              : "l0_memory_open_last",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  if (FORGET.test(text) || FORGET.test(nrm)) {
    const scope = /\brecent\b/i.test(text) || /\brecent\b/i.test(nrm)
      ? "recent"
      : "workspace";
    return {
      kind: "plan",
      plan: {
        goal: `Forget ${scope} context`,
        confidence: 0.88,
        steps: [
          {
            tool: "memory.forget_context",
            args: { scope },
            reason: "l0_memory_forget",
          },
        ],
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  // "jkf means C:\...\jkf" or "remember her rides means HerRidez"
  const means =
    text.match(
      /^(?:please\s+)?(?:remember that\s+)?(.+?)\s+means\s+(.+?)\s*$/i,
    ) ??
    nrm.match(
      /^(?:please\s+)?(?:remember that\s+)?(.+?)\s+means\s+(.+?)\s*$/i,
    );
  if (means?.[1] && means?.[2]) {
    const spoken = stripQuotes(means[1].replace(/^remember(?:\s+that)?\s+/i, ""));
    const canonical = stripQuotes(means[2]);
    if (
      spoken.length >= 1 &&
      canonical.length >= 1 &&
      !/\bmeans\b/i.test(spoken)
    ) {
      const asPath =
        /^[A-Za-z]:[\\/]/.test(canonical) || canonical.includes("\\")
          ? canonical
          : undefined;
      return {
        kind: "plan",
        plan: {
          goal: `Learn correction: ${spoken} → ${canonical}`,
          confidence: 0.9,
          steps: [
            {
              tool: "memory.learn_correction",
              args: {
                spokenForm: spoken,
                canonicalForm: canonical,
                ...(asPath ? { asAliasPath: asPath } : {}),
              },
              reason: "l0_memory_learn_correction",
            },
          ],
          rawUtterance: rawCommand,
          normalizedUtterance: normalized,
          source: "L0",
        },
      };
    }
  }

  return null;
}
