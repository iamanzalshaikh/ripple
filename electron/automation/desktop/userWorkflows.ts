import {
  getWorkflowGraph,
  listWorkflowGraph,
  recordWorkflowRun,
  removeWorkflowGraph,
  saveWorkflowGraph,
  type SaveWorkflowOptions,
} from "../../storage/workflowGraph.js";
import { normalizeRegistryKey, sanitizeSpokenName } from "./spokenName.js";
import { resolveAlias } from "./aliasRegistry.js";
import { findNativeAppById, resolveNativeApp } from "./nativeAppRegistry.js";
import { launchNativeApp } from "./launchApp.js";
import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";
import { openUrlInBrowser } from "../openUrl.js";
import { findWorkspaceById, resolveWorkspace } from "./workspaceRegistry.js";
import { rememberWorkflowEntity } from "../../storage/knowledgeGraph.js";

export type WorkflowStepDef =
  | { type: "app"; target: string }
  | { type: "workspace"; target: string }
  | { type: "folder"; target: string }
  | { type: "alias"; target: string };

export interface UserWorkflow {
  id: string;
  name: string;
  steps: WorkflowStepDef[];
  version?: number;
}

function normalizeKey(name: string): string {
  return normalizeRegistryKey(name);
}

function graphToUserWorkflow(entry: {
  name: string;
  version: number;
  steps: WorkflowStepDef[];
}): UserWorkflow {
  return {
    id: entry.name,
    name: entry.name,
    steps: entry.steps,
    version: entry.version,
  };
}

export function listWorkflows(): UserWorkflow[] {
  return listWorkflowGraph().map(graphToUserWorkflow);
}

export function resolveWorkflowExact(
  spoken: string,
  version?: number,
): UserWorkflow | null {
  const raw = normalizeKey(spoken);
  const entry = getWorkflowGraph(raw, version);
  if (entry) return graphToUserWorkflow(entry);

  if (raw.startsWith("my ")) {
    const stripped = getWorkflowGraph(raw.slice(3), version);
    if (stripped) return graphToUserWorkflow(stripped);
  }
  const withMy = getWorkflowGraph(`my ${raw}`, version);
  if (withMy) return graphToUserWorkflow(withMy);

  return null;
}

/** Fuzzy match — avoid for run; use resolveWorkflowExact instead. */
export function resolveWorkflow(spoken: string): UserWorkflow | null {
  const exact = resolveWorkflowExact(spoken);
  if (exact) return exact;

  const raw = normalizeKey(spoken);
  const keys = listWorkflows().map((w) => w.name).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (raw === key || raw.endsWith(` ${key}`)) {
      return resolveWorkflowExact(key) ?? null;
    }
  }

  return null;
}

export function resolveStepTarget(spoken: string): WorkflowStepDef {
  const name = spoken.trim();
  const app = resolveNativeApp(name);
  if (app) return { type: "app", target: app.id };

  const ws = resolveWorkspace(name);
  if (ws) return { type: "workspace", target: ws.id };

  const alias = resolveAlias(name);
  if (alias) return { type: "alias", target: alias.name };

  const folderKeys = ["downloads", "documents", "desktop"];
  const lower = name.toLowerCase();
  if (folderKeys.some((f) => lower.includes(f))) {
    if (lower.includes("download")) return { type: "folder", target: "downloads" };
    if (lower.includes("document")) return { type: "folder", target: "documents" };
    return { type: "folder", target: "desktop" };
  }

  return { type: "workspace", target: normalizeKey(name) };
}

export function parseWorkflowStepList(raw: string): WorkflowStepDef[] {
  return raw
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => resolveStepTarget(part));
}

export function saveWorkflow(
  name: string,
  steps: WorkflowStepDef[],
  options?: SaveWorkflowOptions,
): UserWorkflow {
  const key = sanitizeSpokenName(name);
  const entry = saveWorkflowGraph(key, steps, options);
  rememberWorkflowEntity(key, steps.length);
  const stepLabels = steps.map((s) => `${s.type}:${s.target}`).join(" -> ");
  console.info(
    `[ripple-desktop] Workflow "${entry.name}" v${entry.version} [${stepLabels}]`,
  );
  return graphToUserWorkflow(entry);
}

export function removeWorkflow(name: string): boolean {
  const key = normalizeKey(name);
  const removed = removeWorkflowGraph(key);
  if (removed) {
    console.info(`[ripple-desktop] Workflow removed: "${key}"`);
  }
  return removed;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(step: WorkflowStepDef): Promise<string> {
  switch (step.type) {
    case "app": {
      const app = findNativeAppById(step.target) ?? resolveNativeApp(step.target);
      if (!app) throw new Error(`Unknown app in workflow: ${step.target}`);
      return launchNativeApp(app);
    }
    case "workspace": {
      const ws =
        findWorkspaceById(step.target) ?? resolveWorkspace(step.target);
      if (!ws) throw new Error(`Unknown workspace in workflow: ${step.target}`);
      await openUrlInBrowser(ws.url);
      return `Opened ${ws.id}`;
    }
    case "folder":
      return openFolder(resolveFolderPath(step.target));
    case "alias": {
      const alias = resolveAlias(step.target);
      if (!alias) throw new Error(`Unknown alias in workflow: ${step.target}`);
      if (alias.type === "workspace" || /^https?:\/\//i.test(alias.path)) {
        await openUrlInBrowser(alias.path);
        return `Opened ${alias.name}`;
      }
      if (alias.type === "file") {
        return openFile(alias.path);
      }
      return openFolder(alias.path);
    }
    default:
      throw new Error("Unknown workflow step type");
  }
}

export async function runUserWorkflow(workflow: UserWorkflow): Promise<string> {
  recordWorkflowRun(workflow.name, workflow.version);
  const results: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    try {
      results.push(await runStep(step));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      console.warn(
        `[ripple-desktop] Workflow step failed (${step.type}:${step.target}): ${msg}`,
      );
    }

    if (i < workflow.steps.length - 1) {
      await delay(450);
    }
  }

  if (results.length === 0) {
    throw new Error(errors.join("; ") || "Workflow failed");
  }

  const ver = workflow.version ? ` v${workflow.version}` : "";
  const summary = `Started ${workflow.name}${ver}: ${results.join(", ")}`;
  if (errors.length > 0) {
    return `${summary} (some steps failed: ${errors.join("; ")})`;
  }
  return summary;
}

/** @deprecated JSON store removed — kept for tests that imported loadWorkflows */
export function loadWorkflows(): { workflows: Record<string, UserWorkflow> } {
  const map: Record<string, UserWorkflow> = {};
  for (const wf of listWorkflows()) {
    map[wf.id] = wf;
  }
  return { workflows: map };
}

export function saveWorkflows(): void {
  /* no-op — workflows persist in workflow_graph SQLite */
}
