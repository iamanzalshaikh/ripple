/**
 * Parse docs/test5.-6.md → scripts/test56-matrix-cases.json
 * Supports:
 *   ## Test N  + Command: + ```cmd```
 *   ### Step N + ```cmd```
 * Tests 1–50 = P5.5, 51–100 = P6.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MD = join(ROOT, "docs", "test5.-6.md");
const OUT = join(ROOT, "scripts", "test56-matrix-cases.json");

function extractAllCommands(text) {
  const byNum = new Map();

  // ## Test N ... Command: ```cmd```
  const testRe =
    /##\s+Test\s+(\d+)\s*\r?\n[\s\S]*?Command:\s*\r?\n+\s*```\r?\n([\s\S]*?)```/gi;
  let m;
  while ((m = testRe.exec(text))) {
    const num = Number(m[1]);
    const cmd = m[2].trim();
    if (cmd && !byNum.has(num)) byNum.set(num, cmd);
  }

  // ### Step N ```cmd``` (final demo flow 91–100)
  const stepRe = /###\s+Step\s+(\d+)\s*\r?\n+\s*```\r?\n([\s\S]*?)```/gi;
  while ((m = stepRe.exec(text))) {
    const num = Number(m[1]);
    const cmd = m[2].trim();
    if (cmd && !byNum.has(num)) byNum.set(num, cmd);
  }

  return [...byNum.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, command]) => ({ index, command }));
}

function sectionFor(idx) {
  if (idx <= 50) return "P5.5";
  return "P6";
}

function expectFor(section, idx, command) {
  if (section === "P5.5") {
    if (/delete|remove|forget everything|dangerous|system files/i.test(command)) {
      return { kind: "blocked" };
    }
    if (/plan|roadmap|checklist|strategy|workflow/i.test(command)) {
      return {
        kind: "execute",
        tools: ["ai.generate_action_plan"],
        altToolSets: [["ai.reason_about_task"]],
        altKinds: ["partial", "defer", "clarify"],
      };
    }
    if (/why|reason|suggest|explain|analyze|what should/i.test(command)) {
      return {
        kind: "execute",
        tools: ["ai.reason_about_task"],
        altToolSets: [["ai.summarize_screen"], ["ai.extract_context"]],
        altKinds: ["partial", "defer", "clarify"],
      };
    }
    return {
      kind: "execute",
      tools: ["ai.summarize_screen"],
      altToolSets: [
        ["ai.extract_context"],
        ["ai.detect_element"],
        ["ai.reason_about_task"],
      ],
      altKinds: ["partial", "defer", "clarify"],
    };
  }

  if (section === "P6") {
    if (/forget everything/i.test(command)) {
      return { kind: "blocked" };
    }
    if (/forget/i.test(command)) {
      return {
        kind: "execute",
        tools: ["memory.update_preference"],
        altToolSets: [["memory.forget_context"]],
        altKinds: ["partial", "defer", "clarify"],
      };
    }
    if (/remember|always|prefer|save this/i.test(command)) {
      return {
        kind: "execute",
        tools: ["memory.update_preference"],
        altToolSets: [
          ["memory.set_active_workspace"],
          ["memory.learn_correction"],
        ],
        altKinds: ["partial", "defer", "clarify"],
      };
    }
    if (/open my|last project|continue|main project/i.test(command)) {
      return {
        kind: "execute",
        tools: ["automation.open_project"],
        altToolSets: [
          ["memory.get_active_workspace"],
          ["memory.set_active_workspace"],
        ],
        altKinds: ["partial", "defer", "clarify"],
      };
    }
    return {
      kind: "execute",
      toolPrefixes: ["memory.", "automation.", "ai."],
      altKinds: ["partial", "defer", "clarify"],
    };
  }

  return { kind: "execute", altKinds: ["partial", "defer", "clarify"] };
}

function buildCases() {
  const text = readFileSync(MD, "utf8");
  const numbered = extractAllCommands(text);
  if (numbered.length < 50) {
    throw new Error(
      `Expected ~100 commands in test5.-6.md, got ${numbered.length}`,
    );
  }

  const cases = [];
  for (const { index: idx, command } of numbered) {
    // Skip path-only fences from Test Environment
    if (/^[A-Za-z]:\\/.test(command) && command.split("\n").length === 1) {
      continue;
    }
    const section = sectionFor(idx);
    const prefix = section === "P5.5" ? "P55" : "P6";
    const exp = expectFor(section, idx, command);
    cases.push({
      id: `${prefix}-${String(idx).padStart(3, "0")}`,
      section,
      index: idx,
      command,
      ...exp,
    });
  }
  return cases;
}

const cases = buildCases();
writeFileSync(OUT, JSON.stringify(cases, null, 2), "utf8");
console.log(`[test56] wrote ${cases.length} cases → ${OUT}`);
