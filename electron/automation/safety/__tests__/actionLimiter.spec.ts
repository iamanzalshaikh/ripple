import { describe, expect, it, beforeEach } from "vitest";
import {
  checkActionLimit,
  limitMessageFor,
  recordActionUse,
  resetActionLimiterForTests,
} from "../actionLimiter.js";

describe("actionLimiter", () => {
  beforeEach(() => {
    resetActionLimiterForTests();
  });

  it("allows commands under the cap", () => {
    expect(checkActionLimit("launch_app")).toBe(true);
    recordActionUse("launch_app");
    expect(checkActionLimit("launch_app")).toBe(true);
  });

  it("blocks after max launches in window", () => {
    for (let i = 0; i < 20; i++) {
      expect(checkActionLimit("launch_app")).toBe(true);
      recordActionUse("launch_app");
    }
    expect(checkActionLimit("launch_app")).toBe(false);
    expect(limitMessageFor("launch_app")).toMatch(/Too many/i);
  });
});
