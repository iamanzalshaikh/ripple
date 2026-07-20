/**
 * Project-local `.ripple` artifact manager.
 * Reports are trackable; sessions/memory/executions are gitignored.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ArtifactKind,
  ArtifactPresentation,
  ArtifactRef,
} from "../agent/planner/workflowTypes.js";

export type ArtifactWriteRequest = {
  projectRoot: string;
  kind: ArtifactKind;
  /** Relative filename under the kind folder, e.g. security-review-2026-07-18.md */
  relativeName: string;
  content: string;
  contentType?: string;
  schemaId?: string;
  workflowId?: string;
  presentation?: ArtifactPresentation;
  indexInFileSearch?: boolean;
};

export type ArtifactWriteResult = {
  ok: boolean;
  ref?: ArtifactRef;
  error?: string;
};

const KIND_DIRS: Record<ArtifactKind, string> = {
  report: "reports",
  session: "sessions",
  memory: "memory",
  execution: "executions",
};

const MAX_ARTIFACT_BYTES = 512_000;

function normalizeRoot(projectRoot: string): string {
  return resolve(projectRoot.trim());
}

function isReservedName(name: string): boolean {
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name);
}

/** Ensure destination stays under `<project>/.ripple/<kind>/`. */
export function resolveArtifactPath(
  projectRoot: string,
  kind: ArtifactKind,
  relativeName: string,
): { ok: true; absolutePath: string; rippleRoot: string } | { ok: false; error: string } {
  const root = normalizeRoot(projectRoot);
  if (!root || !existsSync(root)) {
    return { ok: false, error: "artifact_project_root_required" };
  }

  const safeName = relativeName.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!safeName || safeName.includes("..") || safeName.startsWith("/") || /^[A-Za-z]:/.test(safeName)) {
    return { ok: false, error: "artifact_invalid_name" };
  }
  if (isReservedName(basename(safeName))) {
    return { ok: false, error: "artifact_reserved_name" };
  }

  const rippleRoot = join(root, ".ripple");
  const kindDir = join(rippleRoot, KIND_DIRS[kind]);
  const absolutePath = resolve(kindDir, safeName);
  const kindResolved = resolve(kindDir) + sep;
  if (!absolutePath.toLowerCase().startsWith(kindResolved.toLowerCase()) && absolutePath.toLowerCase() !== resolve(kindDir).toLowerCase()) {
    return { ok: false, error: "artifact_path_escape" };
  }
  return { ok: true, absolutePath, rippleRoot };
}

function writeAtomic(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = join(dirname(filePath), `.ripple-tmp-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, content, { encoding: "utf8" });
    try {
      renameSync(tmp, filePath);
    } catch {
      // Windows may need unlink-then-rename if destination exists
      if (existsSync(filePath)) unlinkSync(filePath);
      renameSync(tmp, filePath);
    }
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

const IGNORE_LINES = [
  "# Ripple runtime artifacts (reports remain trackable)",
  ".ripple/sessions/",
  ".ripple/memory/",
  ".ripple/executions/",
];

/** Idempotently ignore sessions/memory/executions; leave reports commit-capable. */
export function applyArtifactGitignorePolicy(projectRoot: string): {
  ok: boolean;
  changed: boolean;
  error?: string;
} {
  const root = normalizeRoot(projectRoot);
  if (!root || !existsSync(root)) {
    return { ok: false, changed: false, error: "artifact_project_root_required" };
  }
  const gi = join(root, ".gitignore");
  let existing = "";
  if (existsSync(gi)) {
    existing = readFileSync(gi, "utf8");
  }
  const lines = existing.split(/\r?\n/);
  const missing = IGNORE_LINES.filter((l) => !lines.some((x) => x.trim() === l.trim()));
  if (!missing.length) return { ok: true, changed: false };

  const next =
    (existing.endsWith("\n") || existing.length === 0 ? existing : `${existing}\n`) +
    (existing.trim().length ? "\n" : "") +
    missing.join("\n") +
    "\n";
  writeAtomic(gi, next);
  return { ok: true, changed: true };
}

function upsertManifest(
  rippleRoot: string,
  ref: ArtifactRef & { workflowId?: string },
): void {
  const manifestPath = join(rippleRoot, "manifest.json");
  let data: { version: number; artifacts: Array<Record<string, unknown>> } = {
    version: 1,
    artifacts: [],
  };
  if (existsSync(manifestPath)) {
    try {
      data = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof data;
      if (!Array.isArray(data.artifacts)) data.artifacts = [];
    } catch {
      /* rewrite */
    }
  }
  data.artifacts.unshift({
    id: ref.id,
    kind: ref.kind,
    path: ref.path,
    schemaId: ref.schemaId,
    contentType: ref.contentType,
    createdAt: ref.createdAt,
    presentation: ref.presentation,
    workflowId: ref.workflowId,
  });
  data.artifacts = data.artifacts.slice(0, 200);
  writeAtomic(manifestPath, JSON.stringify(data, null, 2));
}

export function writeArtifact(req: ArtifactWriteRequest): ArtifactWriteResult {
  const resolved = resolveArtifactPath(req.projectRoot, req.kind, req.relativeName);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const bytes = Buffer.byteLength(req.content, "utf8");
  if (bytes > MAX_ARTIFACT_BYTES) {
    return { ok: false, error: `artifact_too_large:${bytes}` };
  }

  try {
    applyArtifactGitignorePolicy(req.projectRoot);
    writeAtomic(resolved.absolutePath, req.content);
    const ref: ArtifactRef = {
      id: `art_${randomUUID().slice(0, 8)}`,
      kind: req.kind,
      path: resolved.absolutePath,
      schemaId: req.schemaId,
      contentType: req.contentType ?? "text/markdown",
      createdAt: new Date().toISOString(),
      presentation: req.presentation ?? "none",
    };
    upsertManifest(resolved.rippleRoot, { ...ref, workflowId: req.workflowId });
    return { ok: true, ref };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "artifact_write_failed",
    };
  }
}

export function datedReportFilename(prefix: string, ext = "md"): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
  return `${prefix}-${stamp}.${ext}`;
}

export async function presentArtifact(
  ref: ArtifactRef,
  presentation: ArtifactPresentation,
): Promise<{ ok: boolean; error?: string }> {
  if (presentation === "none" || presentation === "inline") {
    return { ok: true };
  }
  try {
    if (presentation === "open" || presentation === "ide") {
      const { openFile } = await import("../automation/desktop/openFolder.js");
      await openFile(ref.path);
      return { ok: true };
    }
    if (presentation === "reveal") {
      const { openFolder } = await import("../automation/desktop/openFolder.js");
      await openFolder(dirname(ref.path));
      return { ok: true };
    }
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "artifact_present_failed",
    };
  }
  return { ok: true };
}
