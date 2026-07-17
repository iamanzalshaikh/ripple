/**
 * P7 Whisper Flow — dictation session + revision buffer.
 * Dictation never routes through the OS/compound planner.
 */

export type VoiceUiMode = "command" | "dictation";

export type RevisionBuffer = {
  text: string;
  confirmed: boolean;
  updatedAt: number;
};

export type DictationSessionState = {
  mode: VoiceUiMode;
  active: boolean;
  buffer: RevisionBuffer;
  startedAt: number | null;
};

let state: DictationSessionState = {
  mode: "command",
  active: false,
  buffer: { text: "", confirmed: false, updatedAt: 0 },
  startedAt: null,
};

/** Default ON; set RIPPLE_P85_DICTATION_MODE=0 to force dictation hotkeys → command. */
export function isDictationModeEnabled(): boolean {
  return process.env.RIPPLE_P85_DICTATION_MODE !== "0";
}

export function getVoiceUiMode(): VoiceUiMode {
  return state.mode;
}

export function getDictationSession(): Readonly<DictationSessionState> {
  return state;
}

export function getRevisionBuffer(): Readonly<RevisionBuffer> {
  return state.buffer;
}

export function setVoiceUiMode(mode: VoiceUiMode): void {
  state = { ...state, mode };
}

export function startDictationSession(): void {
  state = {
    mode: "dictation",
    active: true,
    buffer: { text: "", confirmed: false, updatedAt: Date.now() },
    startedAt: Date.now(),
  };
}

export function startCommandSession(): void {
  state = {
    mode: "command",
    active: true,
    buffer: { text: "", confirmed: false, updatedAt: Date.now() },
    startedAt: Date.now(),
  };
}

/** Append a whisper utterance into the revision buffer (not typed yet). */
export function appendDictationUtterance(utterance: string): RevisionBuffer {
  const chunk = utterance.trim();
  if (!chunk) return state.buffer;

  const prev = state.buffer.text.trim();
  const next = prev ? `${prev} ${chunk}` : chunk;
  state = {
    ...state,
    mode: "dictation",
    active: true,
    buffer: {
      text: next,
      confirmed: false,
      updatedAt: Date.now(),
    },
  };
  return state.buffer;
}

export function replaceDictationBuffer(text: string): RevisionBuffer {
  state = {
    ...state,
    buffer: {
      text: text.trim(),
      confirmed: false,
      updatedAt: Date.now(),
    },
  };
  return state.buffer;
}

export function confirmDictationBuffer(finalText?: string): RevisionBuffer {
  const text = (finalText ?? state.buffer.text).trim();
  state = {
    ...state,
    active: false,
    buffer: {
      text,
      confirmed: true,
      updatedAt: Date.now(),
    },
  };
  return state.buffer;
}

export function cancelDictationSession(): void {
  state = {
    mode: state.mode,
    active: false,
    buffer: { text: "", confirmed: false, updatedAt: Date.now() },
    startedAt: null,
  };
}

export function resetDictationSessionForTests(): void {
  state = {
    mode: "command",
    active: false,
    buffer: { text: "", confirmed: false, updatedAt: 0 },
    startedAt: null,
  };
}
