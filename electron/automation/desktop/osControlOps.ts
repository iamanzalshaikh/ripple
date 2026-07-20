import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveItemBySpokenName } from "./itemResolve.js";
import { resolveDestinationDir } from "./fileOperations.js";
import { upsertFileIndexPath } from "../../storage/fileIndex.js";
import {
  findNativeAppById,
  resolveNativeApp,
  type NativeAppEntry,
} from "./nativeAppRegistry.js";
import { resolveLaunchTarget } from "./resolveLaunchTarget.js";
import { listVisibleWindows, type VisibleWindow } from "./windowEnum.js";

const execFileAsync = promisify(execFile);

const COMPARE_FILE_CAP = 500;

function ensureExists(path: string, label: string): void {
  if (!path.trim() || !existsSync(path)) {
    throw new Error(`${label}_not_found:${path || "(empty)"}`);
  }
}

/** Copy a file or folder (recursive) to a destination directory or full path. */
export function copyPathToDestination(
  sourcePath: string,
  destination: string,
): string {
  ensureExists(sourcePath, "source");
  const destRaw = destination.trim();
  if (!destRaw) throw new Error("destination_required");

  const sourceStat = statSync(sourcePath);
  let targetPath: string;

  if (existsSync(destRaw) && statSync(destRaw).isDirectory()) {
    targetPath = join(destRaw, basename(sourcePath));
  } else if (destRaw.endsWith("\\") || destRaw.endsWith("/")) {
    mkdirSync(destRaw, { recursive: true });
    targetPath = join(destRaw, basename(sourcePath));
  } else if (!existsSync(destRaw)) {
    if (sourceStat.isDirectory()) {
      // Folder copy to a destination that doesn't exist yet: the destination
      // itself becomes the copy (cp -r semantics) — "copy Reports to a new
      // folder called Archive" must produce Archive\report1.txt, not
      // Archive\Reports\report1.txt (wave0 TEST 8).
      targetPath = destRaw;
    } else {
      // File copy: destinationFolder is always a container to place the
      // file inside by its own name, never a rename target — "copy demo.txt
      // to Test 2" must produce "Test 2\demo.txt", not a file literally
      // named "Test 2" (W0.3 / FEATURE_GAPS §3.1).
      mkdirSync(destRaw, { recursive: true });
      targetPath = join(destRaw, basename(sourcePath));
    }
  } else {
    // destRaw exists and is not a directory (an existing file) — cannot copy
    // into it; fall through so the existsSync(targetPath) check below reports
    // a clear "already exists" instead of a confusing mkdir failure.
    targetPath = destRaw;
  }

  if (existsSync(targetPath)) {
    throw new Error(`Already exists at destination: ${targetPath}`);
  }

  if (sourceStat.isDirectory()) {
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
  } else {
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
  }

  upsertFileIndexPath(sourcePath);
  upsertFileIndexPath(targetPath);
  return targetPath;
}

export async function copyItemBySpokenName(
  sourceName: string,
  destination: string,
  parent?: string,
): Promise<string> {
  const sourcePath = await resolveItemBySpokenName(sourceName, parent);
  const destDir = resolveDestinationDir(destination, sourcePath);
  mkdirSync(destDir, { recursive: true });
  const target = copyPathToDestination(sourcePath, destDir);
  return `Copied to ${target}`;
}

export type DirCompareResult = {
  left: string;
  right: string;
  onlyLeft: string[];
  onlyRight: string[];
  sizeMismatch: Array<{ relativePath: string; leftBytes: number; rightBytes: number }>;
  sharedCount: number;
  truncated: boolean;
};

function walkRelFiles(root: string, cap: number): Map<string, number> {
  const out = new Map<string, number>();
  const stack = [root];
  while (stack.length > 0 && out.size < cap) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (out.size >= cap) break;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (st.isFile()) {
        const rel = relative(root, full).split(/[\\/]/).join("/");
        out.set(rel, st.size);
      }
    }
  }
  return out;
}

export function compareDirectories(
  leftPath: string,
  rightPath: string,
): DirCompareResult {
  ensureExists(leftPath, "left");
  ensureExists(rightPath, "right");
  if (!statSync(leftPath).isDirectory() || !statSync(rightPath).isDirectory()) {
    throw new Error("compare_directories_requires_folders");
  }

  const left = walkRelFiles(leftPath, COMPARE_FILE_CAP + 1);
  const right = walkRelFiles(rightPath, COMPARE_FILE_CAP + 1);
  const truncated =
    left.size > COMPARE_FILE_CAP || right.size > COMPARE_FILE_CAP;

  const onlyLeft: string[] = [];
  const onlyRight: string[] = [];
  const sizeMismatch: DirCompareResult["sizeMismatch"] = [];
  let sharedCount = 0;

  for (const [rel, size] of left) {
    if (!right.has(rel)) onlyLeft.push(rel);
    else {
      sharedCount += 1;
      const rSize = right.get(rel)!;
      if (rSize !== size) {
        sizeMismatch.push({
          relativePath: rel,
          leftBytes: size,
          rightBytes: rSize,
        });
      }
    }
  }
  for (const rel of right.keys()) {
    if (!left.has(rel)) onlyRight.push(rel);
  }

  return {
    left: leftPath,
    right: rightPath,
    onlyLeft: onlyLeft.slice(0, 100),
    onlyRight: onlyRight.slice(0, 100),
    sizeMismatch: sizeMismatch.slice(0, 50),
    sharedCount,
    truncated,
  };
}

export function compareFiles(
  leftPath: string,
  rightPath: string,
): {
  left: string;
  right: string;
  sameSize: boolean;
  sameHash: boolean;
  leftBytes: number;
  rightBytes: number;
  leftSha256: string;
  rightSha256: string;
} {
  ensureExists(leftPath, "left");
  ensureExists(rightPath, "right");
  if (!statSync(leftPath).isFile() || !statSync(rightPath).isFile()) {
    throw new Error("compare_files_requires_files");
  }
  const leftBytes = statSync(leftPath).size;
  const rightBytes = statSync(rightPath).size;
  const leftSha256 = createHash("sha256")
    .update(readFileSync(leftPath))
    .digest("hex");
  const rightSha256 = createHash("sha256")
    .update(readFileSync(rightPath))
    .digest("hex");
  return {
    left: leftPath,
    right: rightPath,
    sameSize: leftBytes === rightBytes,
    sameHash: leftSha256 === rightSha256,
    leftBytes,
    rightBytes,
    leftSha256,
    rightSha256,
  };
}

function resolveAppEntry(appHint: string): NativeAppEntry | null {
  const trimmed = appHint.trim();
  if (!trimmed) return null;
  return findNativeAppById(trimmed) ?? resolveNativeApp(trimmed);
}

/**
 * resolveLaunchTarget returns bare exe names ("notepad.exe") as-is for
 * built-in Windows apps — fine for the normal (non-admin) launch path, which
 * trusts Windows' own PATH resolution, but useless for the existsSync check
 * below. Built-in apps like notepad/calc/mspaint live in System32; resolve
 * against it before giving up.
 */
function resolveBareExeTarget(target: string): string {
  if (existsSync(target)) return target;
  if (isAbsolute(target) || target.includes("\\") || target.includes("/")) {
    return target;
  }
  const system32Path = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    target,
  );
  if (existsSync(system32Path)) return system32Path;
  return target;
}

export async function runAppAsAdmin(appOrPath: string): Promise<string> {
  const trimmed = appOrPath.trim();
  if (!trimmed) throw new Error("missing_arg:app");

  let target = trimmed;
  const app = resolveAppEntry(trimmed);
  if (app) {
    target = resolveLaunchTarget(app);
  }
  target = resolveBareExeTarget(target);
  if (!target) {
    throw new Error(`admin_target_not_found:${trimmed}`);
  }
  // Live-discovered UWP/MSIX apps (e.g. Windows Terminal via app discovery —
  // see appDiscovery.ts) resolve to a "shell:AppsFolder\<AUMID>" reference,
  // not a real filesystem path. It contains backslashes so it would trip the
  // looksLikePath heuristic below and fail existsSync (it will never exist on
  // disk), even though `Start-Process -FilePath 'shell:AppsFolder\...' -Verb
  // RunAs` launches it correctly — confirmed directly against PowerShell.
  const isShellUri = /^shell:/i.test(target);
  const looksLikePath =
    !isShellUri &&
    (isAbsolute(target) || target.includes("\\") || target.includes("/"));
  // Some apps (e.g. Windows Terminal's wt.exe) only resolve via an "app
  // execution alias" stub that existsSync can't see but Windows' own PATH
  // search can — only demand existsSync for things that already look like
  // real filesystem paths (including our own System32 resolution above);
  // let PowerShell attempt PATH resolution for anything still bare, and
  // surface a real error if that fails too (never a fake success).
  if (looksLikePath && !existsSync(target)) {
    throw new Error(`admin_target_not_found:${trimmed}`);
  }
  if (!isShellUri && !/\.exe$/i.test(target)) {
    throw new Error(`admin_requires_exe:${target}`);
  }

  // Wave 0 / Playwright bridge: never hang on the Windows UAC prompt.
  // Routing + path resolution are still proven; elevation itself is OS-owned.
  if (process.env.RIPPLE_OS_TEST === "1") {
    return `Resolved admin launch (test mode, UAC skipped): ${target}`;
  }

  const escaped = target.replace(/'/g, "''");
  // Start-Process only has -FilePath (no -LiteralPath exists on this cmdlet
  // at all — confirmed via `Get-Command Start-Process -Syntax`); it doesn't
  // do wildcard expansion, so -FilePath is safe for both real paths and
  // bare PATH-resolved names.
  const verbArg = `-FilePath '${escaped}'`;
  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Start-Process ${verbArg} -Verb RunAs`,
    ],
    { windowsHide: true },
  );
  return `Launched as admin: ${target}`;
}

export async function getAppProperties(appHint: string): Promise<{
  id: string | null;
  name: string;
  path: string;
  exists: boolean;
  version: string | null;
  productName: string | null;
  company: string | null;
}> {
  const trimmed = appHint.trim();
  if (!trimmed) throw new Error("missing_arg:app");

  const app = resolveAppEntry(trimmed);
  const path = app ? resolveLaunchTarget(app) : trimmed;
  const name = app?.name ?? basename(path);
  const exists = existsSync(path);

  let version: string | null = null;
  let productName: string | null = null;
  let company: string | null = null;

  if (exists && /\.exe$/i.test(path)) {
    try {
      const escaped = path.replace(/'/g, "''");
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `$v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo('${escaped}');` +
            `Write-Output ($v.FileVersion + '|' + $v.ProductName + '|' + $v.CompanyName)`,
        ],
        { windowsHide: true },
      );
      const parts = stdout.trim().split("|");
      version = parts[0]?.trim() || null;
      productName = parts[1]?.trim() || null;
      company = parts[2]?.trim() || null;
    } catch {
      /* version optional */
    }
  }

  return {
    id: app?.id ?? null,
    name,
    path,
    exists,
    version,
    productName,
    company,
  };
}

export async function getRunningApps(limit = 40): Promise<
  Array<{
    processName: string;
    windowTitle: string;
    hwnd: number;
  }>
> {
  const rows = await listVisibleWindows();
  const capped = Math.max(1, Math.min(limit, 100));
  return rows.slice(0, capped).map((w: VisibleWindow) => ({
    processName: w.processName,
    windowTitle: w.windowTitle,
    hwnd: w.hwnd,
  }));
}

export async function inspectWindow(query?: string): Promise<{
  match: {
    processName: string;
    windowTitle: string;
    hwnd: number;
  } | null;
  candidates: Array<{
    processName: string;
    windowTitle: string;
    hwnd: number;
  }>;
}> {
  const rows = await listVisibleWindows();
  const mapped = rows.map((w) => ({
    processName: w.processName,
    windowTitle: w.windowTitle,
    hwnd: w.hwnd,
  }));

  const q = query?.trim().toLowerCase();
  if (!q) {
    return { match: mapped[0] ?? null, candidates: mapped.slice(0, 12) };
  }

  const scored = mapped
    .map((w) => {
      const blob = `${w.processName} ${w.windowTitle}`.toLowerCase();
      let score = 0;
      if (blob.includes(q)) score += 10;
      if (w.processName.toLowerCase().includes(q)) score += 5;
      if (w.windowTitle.toLowerCase().includes(q)) score += 5;
      return { w, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    match: scored[0]?.w ?? null,
    candidates: scored.slice(0, 12).map((s) => s.w),
  };
}
