import { afterEach, describe, expect, it } from "vitest";
import { isJarvisEnabled } from "../featureFlags.js";

describe("isJarvisEnabled", () => {
  const prev = process.env.RIPPLE_JARVIS;

  afterEach(() => {
    if (prev === undefined) delete process.env.RIPPLE_JARVIS;
    else process.env.RIPPLE_JARVIS = prev;
  });

  it("is off unless RIPPLE_JARVIS=1", () => {
    delete process.env.RIPPLE_JARVIS;
    expect(isJarvisEnabled()).toBe(false);
    process.env.RIPPLE_JARVIS = "0";
    expect(isJarvisEnabled()).toBe(false);
    process.env.RIPPLE_JARVIS = "1";
    expect(isJarvisEnabled()).toBe(true);
  });
});
