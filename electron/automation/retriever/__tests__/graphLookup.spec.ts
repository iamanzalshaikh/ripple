import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRippleDb } from "../../../storage/rippleDb.js";
import {
  boostAppFromLaunch,
  boostEntityFromOpen,
  clearKnowledgeGraph,
  lookupEntity,
} from "../../../storage/knowledgeGraph.js";
import { graphLookup, graphLookupKeys } from "../graphLookup.js";
import { parseGraphOpenCommand } from "../../desktop/parseGraphOpenCommand.js";

describe("graphLookup P5.5", () => {
  let workDir: string;

  beforeEach(() => {
    initRippleDb();
    clearKnowledgeGraph();
    workDir = mkdtempSync(join(tmpdir(), "ripple-graph-"));
  });

  it("resolves my project and project as aliases", () => {
    const projectPath = join(workDir, "Ripple");
    mkdirSync(projectPath);
    boostEntityFromOpen("my project", projectPath);

    expect(graphLookupKeys("project")).toContain("my project");
    expect(lookupEntity("project")?.type).toBe("project");
    expect(graphLookup("my project")?.path).toBe(projectPath);
    expect(graphLookup("project")?.path).toBe(projectPath);
  });

  it("parseGraphOpenCommand returns open_resolved for learned project", () => {
    const projectPath = join(workDir, "Ripple");
    mkdirSync(projectPath);
    boostEntityFromOpen("my project", projectPath);

    const intent = parseGraphOpenCommand("Open my project");
    expect(intent?.kind).toBe("open_resolved");
    if (intent?.kind === "open_resolved") {
      expect(intent.path).toBe(projectPath);
    }
  });

  it("parseGraphOpenCommand launches app role hits", () => {
    boostAppFromLaunch("vscode", "my editor");
    boostAppFromLaunch("vscode", "my editor");
    boostAppFromLaunch("vscode", "my editor");

    const intent = parseGraphOpenCommand("Open my editor");
    expect(intent?.kind).toBe("launch_app");
    if (intent?.kind === "launch_app") {
      expect(intent.app.id).toBe("vscode");
    }
  });
});
