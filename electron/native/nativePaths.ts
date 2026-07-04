import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

/** Candidate ripple-desktop roots (dev cwd vs bundled out/main). */
export function getRippleDesktopRootCandidates(): string[] {
  const seen = new Set<string>();
  const add = (raw: string | undefined | null) => {
    const p = raw?.trim();
    if (!p) return;
    const norm = join(p);
    if (!seen.has(norm)) seen.add(norm);
  };

  add(process.cwd());

  try {
    add(app.getAppPath());
  } catch {
    /* app not ready */
  }

  try {
    const here = dirname(fileURLToPath(import.meta.url));
    add(join(here, "..", ".."));
    add(join(here, "..", "..", ".."));
    add(join(here, ".."));
  } catch {
    /* ignore */
  }

  return [...seen];
}

export function findRippleDesktopRoot(): string | null {
  for (const root of getRippleDesktopRootCandidates()) {
    if (existsSync(join(root, "ripple-native", "Cargo.toml"))) {
      return root;
    }
  }
  return null;
}

/** P7f — packaged app ships sidecar under resources/native/win32/. */
export function getBundledNativeExePath(): string | null {
  const resources = process.resourcesPath?.trim();
  if (!resources) return null;
  const bundled = join(resources, "native", "win32", "ripple-native.exe");
  return existsSync(bundled) ? bundled : null;
}
