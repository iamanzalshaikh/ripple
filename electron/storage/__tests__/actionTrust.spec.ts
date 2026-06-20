import { describe, expect, it, beforeAll } from "vitest";
import { initRippleDb } from "../rippleDb.js";
import {
  getTrustScore,
  recordTrustSignal,
  shouldAutoExecute,
} from "../actionTrust.js";

describe("actionTrust", () => {
  beforeAll(() => {
    initRippleDb();
  });

  it("accumulates success signals", () => {
    recordTrustSignal("my resume", "success");
    recordTrustSignal("my resume", "success");
    expect(getTrustScore("my resume")).toBeGreaterThanOrEqual(2);
  });

  it("penalizes undo", () => {
    recordTrustSignal("test phrase", "success");
    recordTrustSignal("test phrase", "undo");
    expect(getTrustScore("test phrase")).toBeLessThan(1);
  });

  it("auto-executes at high trust", () => {
    for (let i = 0; i < 10; i++) {
      recordTrustSignal("trusted cmd", "success");
    }
    expect(shouldAutoExecute("trusted cmd", 0.95)).toBe(true);
  });
});
