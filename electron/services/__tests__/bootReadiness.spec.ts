import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceInputReady,
  setVoiceInputReady,
  waitForBackendHealth,
  waitUntilVoiceInputReady,
} from "../bootReadiness.js";

vi.mock("../../native/nativeClient.js", () => ({
  isNativeClientAuthenticated: vi.fn(() => true),
}));

vi.mock("../api.js", () => ({
  apiHealthCheck: vi.fn(),
}));

describe("boot readiness", () => {
  afterEach(() => {
    setVoiceInputReady(false);
    vi.clearAllMocks();
  });

  it("retries health with backoff until success", async () => {
    const ping = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        url: "http://127.0.0.1:3007/api/v1",
        message: "Cannot reach backend",
      })
      .mockResolvedValueOnce({
        ok: false,
        url: "http://127.0.0.1:3007/api/v1",
        message: "Cannot reach backend",
      })
      .mockResolvedValueOnce({
        ok: true,
        url: "http://127.0.0.1:3007/api/v1",
        message: "Backend OK",
        latencyMs: 12,
      });

    const result = await waitForBackendHealth({
      ping,
      attempts: 5,
      initialDelayMs: 1,
      maxDelayMs: 2,
    });
    expect(result.ok).toBe(true);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("does not flip voice input ready by itself — caller enables after hotkeys register", async () => {
    expect(isVoiceInputReady()).toBe(false);
    const ping = vi.fn().mockResolvedValue({
      ok: true,
      url: "http://127.0.0.1:3007/api/v1",
      message: "Backend OK",
    });
    const result = await waitUntilVoiceInputReady({ ping, attempts: 1 });
    expect(result.sidecarOk).toBe(true);
    expect(result.backendOk).toBe(true);
    expect(result.ready).toBe(true);
    expect(isVoiceInputReady()).toBe(false);
    setVoiceInputReady(true);
    expect(isVoiceInputReady()).toBe(true);
  });
});
