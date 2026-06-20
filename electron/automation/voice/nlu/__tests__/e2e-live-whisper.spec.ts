/**
 * Live E2E — real audio → backend Whisper STT → full production pipeline.
 *
 * Prerequisites:
 *   1. ripple-backend running (default http://127.0.0.1:3007)
 *   2. OPENAI_API_KEY on backend
 *   3. RUN_LIVE_TESTS=1
 *
 * Run:
 *   powershell -File scripts/generate-whisper-fixtures.ps1
 *   $env:RUN_LIVE_TESTS="1"; npm run test:e2e:live
 */
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkBackendHealth,
  fixturePath,
  LIVE_WHISPER_CASES,
  resolveLiveToken,
  transcribeWavFile,
  API_BASE,
} from "./e2e-live-api.js";
import { runProductionPipeline } from "./e2e-pipeline.harness.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

const LIVE = process.env.RUN_LIVE_TESTS === "1";

describe.skipIf(!LIVE)("Live E2E — Mic → Whisper → pipeline", () => {
  let token = "";

  beforeAll(async () => {
    const healthy = await checkBackendHealth();
    if (!healthy) {
      throw new Error(`Backend not reachable at ${API_BASE} — start ripple-backend first`);
    }

    const missing = LIVE_WHISPER_CASES.filter(
      (c) => !existsSync(fixturePath(c.fixture)),
    );
    if (missing.length > 0) {
      execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${process.cwd()}/scripts/generate-whisper-fixtures.ps1"`,
        { stdio: "inherit" },
      );
    }

    for (const c of LIVE_WHISPER_CASES) {
      if (!existsSync(fixturePath(c.fixture))) {
        throw new Error(`Missing fixture: ${c.fixture}`);
      }
    }

    token = await resolveLiveToken();
  }, 120_000);

  it("backend health", async () => {
    expect(await checkBackendHealth()).toBe(true);
  });

  it.each(LIVE_WHISPER_CASES.map((c) => [c.fixture, c] as const))(
    "Whisper STT: %s",
    async (_fixture, spec) => {
      const whisperText = await transcribeWavFile(token, fixturePath(spec.fixture));
      expect(whisperText.length).toBeGreaterThan(2);

      if (spec.heardIncludes?.length) {
        const lower = whisperText.toLowerCase();
        expect(
          spec.heardIncludes.some((tok) => lower.includes(tok.toLowerCase())),
        ).toBe(true);
      }

      const result = runProductionPipeline(whisperText);

      expect(result.route).toBe(spec.route);
      const allowedKinds = spec.kinds ?? (spec.kind ? [spec.kind] : []);
      if (allowedKinds.length > 0) {
        expect(allowedKinds).toContain(result.kind);
      }

      console.info(
        `[live-e2e] spoke="${spec.spoken}" heard="${whisperText}" → ${result.route}/${result.kind}`,
      );
    },
    90_000,
  );
});

describe.skipIf(!LIVE)("Live E2E — desktop-intent LLM fallback", () => {
  let token = "";

  beforeAll(async () => {
    const healthy = await checkBackendHealth();
    if (!healthy) {
      throw new Error(`Backend not reachable at ${API_BASE}`);
    }
    token = await resolveLiveToken();
  }, 30_000);

  it("LLM desktop-intent for unresolved Hinglish", async () => {
    const res = await fetch(`${API_BASE}/commands/desktop-intent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: "Yaar kal wali presentation dikhao",
        nlu: "Yesterday's presentation show",
      }),
    });

    if (res.status === 501) {
      console.warn("OPENAI_API_KEY missing — skip LLM");
      return;
    }

    expect([200, 422]).toContain(res.status);
    const body = (await res.json()) as {
      success?: boolean;
      data?: { plan?: { action?: string } };
    };
    if (res.status === 200) {
      expect(body.success).toBe(true);
      expect(body.data?.plan?.action).toBeTruthy();
    }
  }, 30_000);
});
