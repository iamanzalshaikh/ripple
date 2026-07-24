import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_WINDOW_MS,
  getSessionStatus,
  recordSessionUtterance,
  resetSessionWindowForTests,
} from "../dictation/dictationSessionWindow.js";

describe("P7.5 dictation session window", () => {
  beforeEach(() => {
    resetSessionWindowForTests();
  });

  afterEach(() => {
    resetSessionWindowForTests();
    vi.useRealTimers();
  });

  it("starts a session on the first utterance", () => {
    const window = recordSessionUtterance("hello world");
    expect(window.sessionId).toBe(1);
    expect(window.utterances).toHaveLength(1);

    const status = getSessionStatus();
    expect(status?.sessionId).toBe(1);
    expect(status?.utteranceCount).toBe(1);
    expect(status?.windowMs).toBe(SESSION_WINDOW_MS);
  });

  it("groups consecutive utterances into the same session", () => {
    recordSessionUtterance("first");
    recordSessionUtterance("second");
    const window = recordSessionUtterance("third");

    expect(window.sessionId).toBe(1);
    expect(window.utterances.map((u) => u.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(getSessionStatus()?.utteranceCount).toBe(3);
  });

  it("starts a new session once the ~20-minute window elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const first = recordSessionUtterance("start of session");
    expect(first.sessionId).toBe(1);

    vi.setSystemTime(SESSION_WINDOW_MS + 1);
    const second = recordSessionUtterance("after the window");

    expect(second.sessionId).toBe(2);
    expect(second.utterances).toHaveLength(1);
    expect(getSessionStatus()?.sessionId).toBe(2);
    expect(getSessionStatus()?.utteranceCount).toBe(1);
  });

  it("stays within the same session right up to the boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    recordSessionUtterance("start");
    vi.setSystemTime(SESSION_WINDOW_MS);
    const stillSame = recordSessionUtterance("just under the wire");

    expect(stillSame.sessionId).toBe(1);
    expect(stillSame.utterances).toHaveLength(2);
  });

  it("reports remainingMs decreasing toward zero and no status once expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    recordSessionUtterance("start");

    vi.setSystemTime(5 * 60 * 1000);
    const midStatus = getSessionStatus();
    expect(midStatus?.remainingMs).toBe(SESSION_WINDOW_MS - 5 * 60 * 1000);

    vi.setSystemTime(SESSION_WINDOW_MS + 1);
    expect(getSessionStatus()).toBeNull();
  });

  it("returns null status before any utterance is recorded", () => {
    expect(getSessionStatus()).toBeNull();
  });
});
