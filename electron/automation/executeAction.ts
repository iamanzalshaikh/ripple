import { parseWorkflowSteps } from "./actions/showSuggestions.js";
import { executeBackendAction } from "./executeBackendAction.js";
import type { RippleAction } from "./types.js";
import { runExpandedWorkflow } from "./workflow/workflowRunner.js";

/** Run a single action; WORKFLOW uses Phase 3.5 expansion + CDP adapters. */
export async function executeSingleAction(action: RippleAction): Promise<string> {
  if (action.type === "WORKFLOW") {
    const steps = parseWorkflowSteps(action);
    if (steps.length === 0) {
      throw new Error("WORKFLOW has no steps");
    }
    return runExpandedWorkflow(steps);
  }
  return executeBackendAction(action);
}
