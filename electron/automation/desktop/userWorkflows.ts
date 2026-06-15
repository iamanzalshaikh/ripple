import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getWorkflowsFilePath } from "../../config/ripplePaths.js";
import { normalizeRegistryKey, sanitizeSpokenName } from "./spokenName.js";
import { resolveAlias } from "./aliasRegistry.js";
import { findNativeAppById, resolveNativeApp } from "./nativeAppRegistry.js";
import { launchNativeApp } from "./launchApp.js";
import { openFile, openFolder, resolveFolderPath } from "./openFolder.js";
import { openUrlInBrowser } from "../openUrl.js";
import { findWorkspaceById, resolveWorkspace } from "./workspaceRegistry.js";

export type WorkflowStepDef =
  | { type: "app"; target: string }
  | { type: "workspace"; target: string }
  | { type: "folder"; target: string }
  | { type: "alias"; target: string };

export interface UserWorkflow {
  id: string;
  name: string;
  steps: WorkflowStepDef[];
}

interface WorkflowStore {
  workflows: Record<string, UserWorkflow>;
}

let cache: WorkflowStore | null = null;

function normalizeKey(name: string): string {
  return normalizeRegistryKey(name);
}

function migrateWorkflowKeys(store: WorkflowStore): WorkflowStore {
  const next: Record<string, UserWorkflow> = {};
  for (const [key, wf] of Object.entries(store.workflows)) {
    const nk = normalizeKey(key);
    next[nk] = { ...wf, id: nk, name: nk };
  }
  return { workflows: next };
}

function emptyStore(): WorkflowStore {
  return { workflows: {} };
}

export function loadWorkflows(): WorkflowStore {
  if (cache) return cache;

  const file = getWorkflowsFilePath();
  if (!existsSync(file)) {
    cache = emptyStore();
    return cache;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as WorkflowStore;
    cache = parsed?.workflows ? migrateWorkflowKeys(parsed) : emptyStore();
  } catch {
    cache = emptyStore();
  }

  return cache;
}

export function saveWorkflows(store: WorkflowStore): void {
  writeFileSync(getWorkflowsFilePath(), JSON.stringify(store, null, 2), "utf8");
  cache = store;
}

export function listWorkflows(): UserWorkflow[] {
  return Object.values(loadWorkflows().workflows).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function resolveWorkflowExact(spoken: string): UserWorkflow | null {
  const store = loadWorkflows();
  const raw = normalizeKey(spoken);

  if (store.workflows[raw]) return store.workflows[raw];
  if (raw.startsWith("my ") && store.workflows[raw.slice(3)]) {
    return store.workflows[raw.slice(3)];
  }
  const withMy = `my ${raw}`;
  if (store.workflows[withMy]) return store.workflows[withMy];

  return null;
}

/** Fuzzy match — avoid for run; use resolveWorkflowExact instead. */
export function resolveWorkflow(spoken: string): UserWorkflow | null {
  const exact = resolveWorkflowExact(spoken);
  if (exact) return exact;

  const store = loadWorkflows();
  const raw = normalizeKey(spoken);
  const keys = Object.keys(store.workflows).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    if (raw === key || raw.endsWith(` ${key}`)) {
      return store.workflows[key];
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

export function saveWorkflow(name: string, steps: WorkflowStepDef[]): UserWorkflow {
  const key = normalizeKey(name);
  const store = loadWorkflows();
  const existed = Boolean(store.workflows[key]);
  const entry: UserWorkflow = { id: key, name: key, steps };
  store.workflows[key] = entry;
  saveWorkflows(store);
  const stepLabels = steps.map((s) => `${s.type}:${s.target}`).join(" -> ");
  console.info(
    `[ripple-desktop] ${existed ? "Updated" : "Created"} workflow "${key}" [${stepLabels}]`,
  );
  return entry;
}

export function removeWorkflow(name: string): boolean {
  const key = normalizeKey(name);
  const store = loadWorkflows();
  if (!store.workflows[key]) return false;
  delete store.workflows[key];
  saveWorkflows(store);
  console.info(`[ripple-desktop] Workflow removed: "${key}"`);
  return true;
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
  const results: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    try {
      results.push(await runStep(step));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      console.warn(`[ripple-desktop] Workflow step failed (${step.type}:${step.target}): ${msg}`);
    }

    if (i < workflow.steps.length - 1) {
      await delay(450);
    }
  }

  if (results.length === 0) {
    throw new Error(errors.join("; ") || "Workflow failed");
  }

  const summary = `Started ${workflow.name}: ${results.join(", ")}`;
  if (errors.length > 0) {
    return `${summary} (some steps failed: ${errors.join("; ")})`;
  }
  return summary;
}
