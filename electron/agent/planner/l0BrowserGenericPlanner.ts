import { parseOpenUrlCommand } from "../../automation/browser/parseOpenUrlCommand.js";
import type { ExecutionPlan, L0PlannerResult, PlanStep } from "./planTypes.js";

function norm(command: string): string {
  return command.trim().toLowerCase().replace(/\s+/g, " ");
}

function singleStepPlan(
  rawCommand: string,
  normalized: string,
  goal: string,
  step: PlanStep,
): L0PlannerResult {
  return {
    kind: "plan",
    plan: {
      goal,
      confidence: 0.9,
      steps: [step],
      rawUtterance: rawCommand,
      normalizedUtterance: normalized,
      source: "L0",
    },
  };
}

function openUrlPlan(
  rawCommand: string,
  normalized: string,
  url: string,
): ExecutionPlan {
  return {
    goal: `Open ${url}`,
    confidence: 0.92,
    steps: [
      {
        tool: "browser.open_url",
        args: { url },
        reason: "open_url",
      },
    ],
    rawUtterance: rawCommand,
    normalizedUtterance: normalized,
    source: "L0",
  };
}

export function tryL0BrowserGenericPlan(
  rawCommand: string,
  normalized: string,
): L0PlannerResult | null {
  const cmd = norm(rawCommand);
  const nrm = norm(normalized);

  if (
    /read visible text|extract (?:the )?visible|show (?:the )?visible page content/.test(
      cmd,
    ) ||
    /read visible text|extract (?:the )?visible/.test(nrm)
  ) {
    return singleStepPlan(rawCommand, normalized, "Extract page text", {
      tool: "browser.extract_text",
      args: {},
      reason: "extract_text",
    });
  }

  if (/scroll down/.test(cmd) || /scroll down/.test(nrm)) {
    return singleStepPlan(rawCommand, normalized, "Scroll page", {
      tool: "browser.scroll",
      args: { deltaY: 600 },
      reason: "scroll",
    });
  }

  if (/find (?:the )?search/.test(cmd) || /locate message composer/.test(cmd)) {
    return singleStepPlan(rawCommand, normalized, "Find element", {
      tool: "browser.find_element",
      args: { text: "search", partial: true },
      reason: "find_element",
    });
  }

  if (/^click (?:the )?/.test(cmd) || /^click (?:the )?/.test(nrm)) {
    return singleStepPlan(rawCommand, normalized, "Click element", {
      tool: "browser.click",
      args: { text: "search", partial: true },
      reason: "click",
    });
  }

  const typeMatch =
    cmd.match(/^type (.+?) into .+ search/) ??
    nrm.match(/^type (.+?) into .+ search/);
  if (typeMatch?.[1]) {
    return singleStepPlan(rawCommand, normalized, "Type in browser", {
      tool: "browser.type",
      args: { text: typeMatch[1].trim() },
      reason: "browser_type",
    });
  }

  const wikiExtract =
    cmd.match(/^open .+ and extract (?:the )?visible content/) ??
    nrm.match(/^open .+ and extract (?:the )?visible content/);
  if (wikiExtract) {
    const urlIntent = parseOpenUrlCommand(rawCommand) ?? parseOpenUrlCommand(normalized);
    const steps: PlanStep[] = [];
    if (urlIntent) {
      steps.push({
        tool: "browser.open_url",
        args: { url: urlIntent.url },
        reason: "open_url",
      });
    }
    steps.push({
      tool: "browser.extract_text",
      args: {},
      reason: "extract_text",
    });
    return {
      kind: "plan",
      plan: {
        goal: "Open and extract",
        confidence: 0.88,
        steps,
        rawUtterance: rawCommand,
        normalizedUtterance: normalized,
        source: "L0",
      },
    };
  }

  const intent =
    parseOpenUrlCommand(rawCommand) ?? parseOpenUrlCommand(normalized);
  if (!intent) return null;
  return {
    kind: "plan",
    plan: openUrlPlan(rawCommand, normalized, intent.url),
  };
}
