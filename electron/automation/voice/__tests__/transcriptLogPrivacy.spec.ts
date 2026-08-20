import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Row 13.6 — sensitive text must not be printed by production builds.
 *
 * `logTranscriptStage` deliberately logs the "stt_raw" and "command_execute"
 * stages even when transcript debugging is off, so that "did we hear anything
 * at all?" stays diagnosable in the field. Before this guard those two lines
 * also printed the transcript itself — i.e. every dictated message, password
 * or private note the user ever spoke.
 */

const SECRET = "my banking password is hunter2 and my address is 42 Elm St";

async function loadWith(env: string, debugFlag?: string) {
  vi.resetModules();
  const prevEnv = process.env.NODE_ENV;
  const prevFlag = process.env.RIPPLE_TRANSCRIPT_DEBUG;
  process.env.NODE_ENV = env;
  if (debugFlag === undefined) delete process.env.RIPPLE_TRANSCRIPT_DEBUG;
  else process.env.RIPPLE_TRANSCRIPT_DEBUG = debugFlag;

  const mod = await import("../transcriptPipeline.js");
  return {
    mod,
    restore: () => {
      process.env.NODE_ENV = prevEnv;
      if (prevFlag === undefined) delete process.env.RIPPLE_TRANSCRIPT_DEBUG;
      else process.env.RIPPLE_TRANSCRIPT_DEBUG = prevFlag;
    },
  };
}

describe("Row 13.6 — transcript content must not leak into production logs", () => {
  let logged: string[] = [];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = [];
    spy = vi
      .spyOn(console, "info")
      .mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  it("production: stt_raw logs the stage but NOT the spoken text", async () => {
    const { mod, restore } = await loadWith("production");
    try {
      mod.logTranscriptStage("stt_raw", { text: SECRET });

      const line = logged.join("\n");
      expect(line).toContain("stt_raw");
      // The whole point of the row:
      expect(line).not.toContain("hunter2");
      expect(line).not.toContain(SECRET);
      // Length still logged, so an empty transcript is still diagnosable.
      expect(line).toContain(`text_len=${SECRET.length}`);
    } finally {
      restore();
    }
  });

  it("production: command_execute also redacts", async () => {
    const { mod, restore } = await loadWith("production");
    try {
      mod.logTranscriptStage("command_execute", { text: SECRET });
      const line = logged.join("\n");
      expect(line).toContain("command_execute");
      expect(line).not.toContain("hunter2");
    } finally {
      restore();
    }
  });

  it("production: an nlu rewrite is redacted too", async () => {
    const { mod, restore } = await loadWith("production");
    try {
      mod.logTranscriptStage("stt_raw", { text: "abc", nlu: SECRET });
      const line = logged.join("\n");
      expect(line).not.toContain("hunter2");
      expect(line).toContain(`nlu_len=${SECRET.length}`);
    } finally {
      restore();
    }
  });

  it("dev: full text is still logged, so debugging is unaffected", async () => {
    const { mod, restore } = await loadWith("development");
    try {
      mod.logTranscriptStage("stt_raw", { text: SECRET });
      expect(logged.join("\n")).toContain("hunter2");
    } finally {
      restore();
    }
  });

  it("production + explicit opt-in flag: full text returns", async () => {
    const { mod, restore } = await loadWith("production", "1");
    try {
      mod.logTranscriptStage("stt_raw", { text: SECRET });
      expect(logged.join("\n")).toContain("hunter2");
    } finally {
      restore();
    }
  });

  it("production: non-forced stages stay silent entirely", async () => {
    const { mod, restore } = await loadWith("production");
    try {
      mod.logTranscriptStage("after_normalize", { text: SECRET });
      expect(logged.join("\n")).toBe("");
    } finally {
      restore();
    }
  });
});
