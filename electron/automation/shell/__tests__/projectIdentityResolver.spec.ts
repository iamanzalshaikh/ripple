import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { scoreFolderNameMatch } from "../projectPathNormalize.js";
import {
  collapseDuplicateLeaf,
  scoreProjectIdentity,
} from "../projectIdentityResolver.js";
import {
  beginClarificationRound,
  clearClarificationContext,
  resolveClarificationFollowUp,
} from "../../../agent/planner/clarificationEngine.js";
import type { WorldModel } from "../../../agent/types.js";

vi.mock("../../../storage/workContext.js", () => ({
  getLastProjectPath: () => null,
  getActiveWorkspace: () => null,
}));

vi.mock("../../../storage/usageStats.js", () => ({
  rankChoices: () => [{ key: "x", count: 0, rank: 1 }],
}));

vi.mock("../../../storage/fileIndex.js", () => ({
  searchIndexedDirectories: () => [],
}));

function stubWorld(): WorldModel {
  return {
    capturedAt: Date.now(),
    foreground: null,
    focusedField: null,
    focusContext: null,
    mouse: { x: 0, y: 0, deviceUnderCursor: null },
    browser: { surface: null },
    clipboard: { hasText: false, preview: "", length: 0 },
    capabilities: {
      sidecarConnected: false,
      sendInput: true,
      uia: false,
      ocr: false,
      globalHotkey: false,
      elevationInjection: false,
    },
  };
}

describe("P6 project identity scoring", () => {
  it("exact folder name beats short prefix substring", () => {
    expect(scoreFolderNameMatch("school-management", "school-management")).toBe(
      100,
    );
    expect(
      scoreFolderNameMatch("school-management", "school-m"),
    ).toBeLessThan(70);
    expect(
      scoreFolderNameMatch("school-management", "school-management-old"),
    ).toBeLessThan(
      scoreFolderNameMatch("school-management", "school-management"),
    );
  });

  it("collapses duplicate trailing folder segment", () => {
    expect(
      collapseDuplicateLeaf(
        "C:\\Users\\ANZAL\\Desktop\\school-management\\school-management",
      ),
    ).toBe("C:\\Users\\ANZAL\\Desktop\\school-management");
  });

  it("leaves a normal path unchanged", () => {
    const p = "C:\\Users\\ANZAL\\Desktop\\New folder\\backend\\database";
    expect(collapseDuplicateLeaf(p)).toBe(p);
  });

  it("scores exact project root higher than longer prefix folders", () => {
    const exact = scoreProjectIdentity(
      "school-management",
      "C:\\Users\\Test\\Desktop\\school-management",
    );
    const longer = scoreProjectIdentity(
      "school-management",
      "C:\\Users\\Test\\Desktop\\school-management-old",
    );
    expect(exact.score).toBeGreaterThan(longer.score);
    expect(exact.reasons).toContain("exact_folder_name");
  });
});

describe("P6 project identity clarify merge", () => {
  beforeEach(() => clearClarificationContext());
  afterEach(() => clearClarificationContext());

  it("yes confirms pending path into remember-with-path command", () => {
    beginClarificationRound({
      originalCommand: "Remember school-management as my main project",
      normalizedUtterance: "remember school-management as my main project",
      question: "I found:\nC:\\Users\\ANZAL\\Desktop\\school-management\n\nSave?",
      reason: "project_identity_confirm",
      world: stubWorld(),
      confirmPath: "C:\\Users\\ANZAL\\Desktop\\school-management",
      candidatePaths: ["C:\\Users\\ANZAL\\Desktop\\school-management"],
    });

    const merged = resolveClarificationFollowUp("Yes");
    expect(merged?.mergedCommand).toBe(
      "Remember C:\\Users\\ANZAL\\Desktop\\school-management as my main project",
    );
  });

  it("does NOT merge a real Open command into a pending confirm (memory/action separation)", () => {
    beginClarificationRound({
      originalCommand: "Remember school-management as my main project",
      normalizedUtterance: "remember school-management as my main project",
      question: "I found:\nC:\\Users\\ANZAL\\Desktop\\school-management\n\nSave?",
      reason: "project_identity_confirm",
      world: stubWorld(),
      confirmPath: "C:\\Users\\ANZAL\\Desktop\\school-management",
      candidatePaths: ["C:\\Users\\ANZAL\\Desktop\\school-management"],
    });

    const merged = resolveClarificationFollowUp("Open my main project");
    expect(merged).toBeNull();
  });

  it("numeric pick selects ambiguous candidate", () => {
    beginClarificationRound({
      originalCommand: "Remember school-management as my main project",
      normalizedUtterance: "remember school-management as my main project",
      question: "Which?",
      reason: "project_identity_ambiguous",
      world: stubWorld(),
      candidatePaths: [
        "C:\\Users\\ANZAL\\Desktop\\school-management",
        "C:\\Users\\ANZAL\\Desktop\\school-management-old",
      ],
    });

    const merged = resolveClarificationFollowUp("1");
    expect(merged?.mergedCommand).toContain("school-management");
    expect(merged?.mergedCommand).not.toContain("school-management-old");
  });
});
