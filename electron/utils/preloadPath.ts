import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Resolve preload script — works in dev and production bundles. */
export function resolvePreloadPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../preload/index.mjs"),
    join(here, "../preload/index.js"),
    join(here, "../../preload/index.mjs"),
    join(here, "../../preload/index.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return join(here, "../preload/index.mjs");
}
