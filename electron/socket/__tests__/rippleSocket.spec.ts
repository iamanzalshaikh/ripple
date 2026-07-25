import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P7.8 finalization — regression test for bug #2: flushVoice() used to fire
 * handlePartialTranscript() (and the progressive OS insert inside it)
 * without awaiting it. stopRecording's final flush-before-endVoice call
 * awaits flushVoice() itself, so a caller relying on that await to mean
 * "any resulting insert has finished" was wrong — executeDictation.ts's
 * reconcile could run concurrently with a still-in-flight insert. This test
 * proves flushVoice()'s returned promise now genuinely waits.
 */

let resolveApply: (() => void) | null = null;
const applyStreamingPartial = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveApply = resolve;
    }),
);

vi.mock("../../agent/dictation/streamingInsert.js", () => ({
  applyStreamingPartial: (...args: unknown[]) =>
    (applyStreamingPartial as (...a: unknown[]) => Promise<void>)(...args),
}));

const emitWithAckMock = vi.fn(async (event: string, _payload?: unknown) => {
  if (event === "voice:flush") {
    return {
      success: true,
      data: { text: "hello wor", stream_id: "stream-1" },
    };
  }
  return { success: true, data: {} };
});

vi.mock("socket.io-client", () => ({
  io: () => ({
    connected: true,
    on: () => undefined,
    once: (event: string, cb: () => void) => {
      if (event === "connect") queueMicrotask(cb);
    },
    off: () => undefined,
    removeAllListeners: () => undefined,
    disconnect: () => undefined,
    timeout: () => ({
      emitWithAck: (event: string, payload: unknown) =>
        emitWithAckMock(event, payload),
    }),
  }),
}));

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock("../../config/env.js", () => ({
  getSocketUrl: () => "http://localhost:0",
}));

describe("P7.8 rippleSocket.flushVoice — awaits the resulting progressive insert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveApply = null;
  });
  afterEach(() => {
    resolveApply = null;
  });

  it("does not resolve until applyStreamingPartial's insert has finished", async () => {
    const { rippleSocket } = await import("../rippleSocket.js");
    await rippleSocket.connect("fake-token");

    const flushPromise = rippleSocket.flushVoice("stream-1");

    let settled = false;
    void flushPromise.then(() => {
      settled = true;
    });

    // Let pending microtasks run without the deferred insert resolving.
    await new Promise((r) => setTimeout(r, 10));
    expect(applyStreamingPartial).toHaveBeenCalledWith({
      streamId: "stream-1",
      text: "hello wor",
    });
    expect(settled).toBe(false);

    resolveApply?.();
    await flushPromise;
    expect(settled).toBe(true);
  });
});
