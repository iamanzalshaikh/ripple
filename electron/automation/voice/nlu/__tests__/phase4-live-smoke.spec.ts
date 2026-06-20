/**
 * Live E2E smoke — requires ripple-backend running + OPENAI_API_KEY for full Whisper.
 * Run: npm run test:e2e:live
 * Set RIPPLE_TEST_TOKEN in ripple-desktop/.env
 */
import { describe, expect, it, beforeAll } from "vitest";
import { API_BASE, resolveLiveToken } from "./e2e-live-api.js";

const LIVE = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!LIVE)("Live E2E — backend voice API", () => {
  let token = "";

  beforeAll(async () => {
    token = await resolveLiveToken();
  }, 30_000);

  it("health check", async () => {
    const res = await fetch(`${API_BASE}/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it("transcribe rejects missing audio (endpoint alive)", async () => {
    const res = await fetch(`${API_BASE}/voice/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!LIVE)("Live E2E — desktop-intent LLM", () => {
  let token = "";

  beforeAll(async () => {
    token = await resolveLiveToken();
  }, 30_000);

  it("desktop-intent for Hinglish phrase", async () => {
    const res = await fetch(`${API_BASE}/commands/desktop-intent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: "Bhai mera resume kholo",
        nlu: "Open my resume",
      }),
    });
    if (res.status === 422) {
      console.warn("LLM rejected — check OPENAI_API_KEY on backend");
      return;
    }
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { plan?: { action?: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data?.plan?.action).toBeTruthy();
  });
});
