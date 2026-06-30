import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_ROLE_HINTS } from "../automation/desktop/appRoles.js";
import {
  findNativeAppById,
  resolveNativeApp,
} from "../automation/desktop/nativeAppRegistry.js";
import { addAlias } from "../automation/desktop/aliasRegistry.js";
import { boostEntityFromOpen, lookupEntity, rememberEntity } from "./knowledgeGraph.js";

/** Seed app roles + common file aliases so first-run demos work without learning. */
export function bootstrapDemoSeeds(): void {
  seedDefaultAppRoles();
  seedResumeAlias();
  seedProjectFolder();
}

function seedDefaultAppRoles(): void {
  for (const [roleKey, hints] of Object.entries(APP_ROLE_HINTS)) {
    if (lookupEntity(roleKey)) continue;

    for (const hint of hints) {
      const app =
        findNativeAppById(hint) ?? resolveNativeApp(hint);
      if (!app) continue;

      rememberEntity({
        key: roleKey,
        path: app.id,
        type: "app_role",
        composite_score: 0.72,
        open_count: 0,
      });
      break;
    }
  }
}

function seedResumeAlias(): void {
  const keys = ["my resume", "resume", "mera resume", "rizume"];
  if (keys.some((k) => lookupEntity(k))) return;

  const roots = [
    join(homedir(), "Downloads"),
    join(homedir(), "Documents"),
    join(homedir(), "Desktop"),
  ];

  const names = [
    "resume.pdf",
    "Resume.pdf",
    "CV.pdf",
    "cv.pdf",
    "resume.docx",
    "Resume.docx",
  ];

  for (const root of roots) {
    for (const name of names) {
      const path = join(root, name);
      if (!existsSync(path)) continue;

      try {
        addAlias("my resume", path, "file");
        boostEntityFromOpen("my resume", path);
        boostEntityFromOpen("resume", path);
      } catch {
        boostEntityFromOpen("my resume", path);
      }
      return;
    }
  }
}

function seedProjectFolder(): void {
  const keys = ["my project", "project"];
  if (keys.some((k) => lookupEntity(k))) return;

  const candidates = [
    join(homedir(), "Desktop", "projectRipple"),
    join(homedir(), "Desktop", "Projects", "Ripple"),
    join(homedir(), "Documents", "projectRipple"),
    join(homedir(), "Projects", "Ripple"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      if (!statSync(path).isDirectory()) continue;
    } catch {
      continue;
    }
    boostEntityFromOpen("my project", path);
    return;
  }
}
