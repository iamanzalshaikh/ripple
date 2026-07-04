import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const release = join(root, "ripple-native", "target", "release", "ripple-native.exe");
const debug = join(root, "ripple-native", "target", "debug", "ripple-native.exe");
const src = existsSync(release) ? release : existsSync(debug) ? debug : null;

if (!src) {
  console.warn("[native:copy] ripple-native.exe not found — run npm run native:build");
  process.exit(0);
}

const destDir = join(root, "resources", "native", "win32");
const dest = join(destDir, "ripple-native.exe");
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[native:copy] ${src} → ${dest}`);
