import { existsSync } from "node:fs";
import { truncateShellOutput } from "./runCommand.js";
import {
  IGNORED_DIR_NAMES,
  listProjectSourceFiles,
  resolvePriorityFiles,
} from "./projectScan.js";

export async function scanProject(projectRoot: string): Promise<string> {
  const root = projectRoot.trim();
  if (!root || !existsSync(root)) {
    throw new Error("project_root_missing");
  }

  const priority = resolvePriorityFiles(root);
  const files = listProjectSourceFiles(root, { maxFiles: 500 });

  const areaCounts = new Map<string, number>();
  for (const file of files) {
    areaCounts.set(file.area, (areaCounts.get(file.area) ?? 0) + 1);
  }

  const lines: string[] = [`Scanning project: ${root}`, ""];
  lines.push("Priority files:");
  for (const item of priority) {
    lines.push(item.exists ? `  ✓ ${item.rel}` : `  ○ ${item.rel} (not found)`);
  }

  lines.push("");
  lines.push("Source areas:");
  const sortedAreas = [...areaCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!sortedAreas.length) {
    lines.push("  (no scannable source files found)");
  } else {
    for (const [area, count] of sortedAreas) {
      lines.push(`  ${area}: ${count} file${count === 1 ? "" : "s"}`);
    }
  }

  lines.push("");
  lines.push(
    `Skipped dirs: ${[...IGNORED_DIR_NAMES].sort().join(", ")}`,
  );
  lines.push(`Total scannable files: ${files.length}`);

  return truncateShellOutput(lines.join("\n"));
}
