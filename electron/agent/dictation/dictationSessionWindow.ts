/**
 * P7.5 — multi-utterance dictation session window.
 *
 * dictationSession.ts tracks one hold-to-talk utterance at a time (its
 * `active`/`confirmed` state resets on every start/confirm). This module is
 * additive: it groups a run of utterances into a single logical "session"
 * (Wispr Flow's ~20-minute session claim) as long as they keep arriving
 * within SESSION_WINDOW_MS of the session's start. Once that window elapses,
 * the next utterance silently opens a new session — no user action needed.
 */

export const SESSION_WINDOW_MS = 20 * 60 * 1000;

export type SessionUtteranceRecord = {
  text: string;
  insertedAt: number;
  processName?: string;
};

export type DictationSessionWindow = {
  sessionId: number;
  startedAt: number;
  lastActivityAt: number;
  utterances: SessionUtteranceRecord[];
};

export type DictationSessionStatus = {
  sessionId: number;
  utteranceCount: number;
  elapsedMs: number;
  remainingMs: number;
  windowMs: number;
};

let currentWindow: DictationSessionWindow | null = null;
let nextSessionId = 1;

function isExpired(now: number): boolean {
  if (!currentWindow) return true;
  return now - currentWindow.startedAt > SESSION_WINDOW_MS;
}

/**
 * Record a confirmed utterance, continuing the active session if it's still
 * within the ~20-minute window, else starting a fresh one.
 */
export function recordSessionUtterance(
  text: string,
  processName?: string,
): DictationSessionWindow {
  const now = Date.now();
  if (isExpired(now)) {
    currentWindow = {
      sessionId: nextSessionId++,
      startedAt: now,
      lastActivityAt: now,
      utterances: [],
    };
  }
  const window = currentWindow as DictationSessionWindow;
  window.utterances.push({ text, insertedAt: now, processName });
  window.lastActivityAt = now;
  return window;
}

export function getSessionWindow(): Readonly<DictationSessionWindow> | null {
  return currentWindow;
}

export function getSessionStatus(now: number = Date.now()): DictationSessionStatus | null {
  if (!currentWindow || isExpired(now)) return null;
  return {
    sessionId: currentWindow.sessionId,
    utteranceCount: currentWindow.utterances.length,
    elapsedMs: now - currentWindow.startedAt,
    remainingMs: Math.max(0, SESSION_WINDOW_MS - (now - currentWindow.startedAt)),
    windowMs: SESSION_WINDOW_MS,
  };
}

export function endSessionWindow(): void {
  currentWindow = null;
}

export function resetSessionWindowForTests(): void {
  currentWindow = null;
  nextSessionId = 1;
}
