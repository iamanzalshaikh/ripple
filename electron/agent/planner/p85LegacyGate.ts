import { parseNativeCommandStrict } from "../../automation/desktop/parseNativeCommand.js";
import { parseBrowserWorkspaceSearch } from "../../automation/browser/parseBrowserWorkspaceSearch.js";
import { normalizeIntent } from "./intentNormalizer.js";
import { shouldBlockLegacyForCompound } from "./compoundGate.js";
import { tryL0CompoundPlan } from "./l0CompoundPlanner.js";
import { nativeIntentToPlanStep } from "./nativeIntentToPlanStep.js";
import { classifyUtterance } from "./utteranceClassifier.js";
import {
  plannerV2AtomicEnabled,
  plannerV2CompoundEnabled,
} from "./v2/plannerV2Config.js";
import { planAtomicWithV2, planCompoundWithV2 } from "./v2/plannerV2.js";
import { shouldBypassP85Planner } from "./gptFallbackPolicy.js";

/** True when P8.5 L0 owns this utterance — legacy desktop-fast must not run. */
export function shouldBlockLegacyDesktopRouters(
  command: string,
  normalized?: string,
): boolean {
  if (shouldBypassP85Planner(command)) return false;

  const norm = normalized ?? normalizeIntent(command);
  if (!norm) return false;

  if (shouldBlockLegacyForCompound(command, norm)) return true;

  if (plannerV2CompoundEnabled() && classifyUtterance(command, norm) === "compound") {
    const v2 = planCompoundWithV2(command, norm);
    if (v2) return true;
  }

  if (plannerV2AtomicEnabled()) {
    const atomic = planAtomicWithV2(command, norm);
    if (atomic?.kind === "plan") return true;
  }

  if (tryL0CompoundPlan(command, norm)) return true;

  const browserSearch = parseBrowserWorkspaceSearch(norm);
  if (browserSearch && nativeIntentToPlanStep(browserSearch)) return true;

  const strict = parseNativeCommandStrict(norm);
  if (strict) {
    const step = nativeIntentToPlanStep(strict);
    if (step) return true;
  }

  return false;
}
