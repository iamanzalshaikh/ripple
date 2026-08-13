/**
 * P11.1 (rebuild) — the Flow Bar. Previously this was inline JSX in
 * Overlay.tsx styled as a plain rounded pill with a single pulsing dot and
 * text badges. This is a genuine replacement: its own component, its own
 * visual language (instrument-panel HUD, monospace status type, real
 * per-mode iconography, a real waveform meter instead of one dot), not the
 * old pill with more badges bolted on.
 *
 * P11.3 — Scratchpad / Notes button.
 * P11.4 — Transforms wand (same entry as F9).
 * P10.2 — Meeting Notetaker mode (red pulse + elapsed + stop).
 */

export type FlowBarMode = "command" | "dictation" | "transform" | "meeting";
export type FlowBarPhase = "idle" | "listening" | "processing" | "result" | "error";

type Props = {
  mode: FlowBarMode;
  phase: FlowBarPhase;
  statusText: string;
  hotkeyHint: string;
  languageCode: string;
  languageBusy: boolean;
  onOpenLanguageMenu: () => void;
  onOpenScratchpad: () => void;
  onStartTransform: () => void;
  /** P10.2 — stop meeting recording from the bar. */
  onStopMeeting?: () => void;
  sessionBadge: string | null;
  detectedLanguageBadge: string | null;
  /** P10.2 — live transcript snippet while meeting. */
  meetingSnippet?: string | null;
};

const MODE_ACCENT: Record<FlowBarMode, { ring: string; glow: string; fg: string }> = {
  command: {
    ring: "border-violet-500/50",
    glow: "shadow-[0_10px_36px_rgba(0,0,0,0.55),0_0_28px_rgba(124,58,237,0.22)]",
    fg: "text-violet-300",
  },
  dictation: {
    ring: "border-emerald-500/50",
    glow: "shadow-[0_10px_36px_rgba(0,0,0,0.55),0_0_28px_rgba(16,185,129,0.22)]",
    fg: "text-emerald-300",
  },
  transform: {
    ring: "border-amber-500/50",
    glow: "shadow-[0_10px_36px_rgba(0,0,0,0.55),0_0_28px_rgba(245,158,11,0.22)]",
    fg: "text-amber-300",
  },
  meeting: {
    ring: "border-rose-500/55",
    glow: "shadow-[0_10px_36px_rgba(0,0,0,0.55),0_0_28px_rgba(244,63,94,0.28)]",
    fg: "text-rose-300",
  },
};

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <rect x="5" y="1" width="4" height="7" rx="2" fill="currentColor" />
      <path
        d="M3 6.5C3 8.98 4.79 11 7 11s4-2.02 4-4.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M7 11v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function WandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <path
        d="M2 12L9 5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M10 2l.6 1.4L12 4l-1.4.6L10 6l-.6-1.4L8 4l1.4-.6L10 2z" fill="currentColor" />
      <path d="M4 9.5l.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4.9-.4.4-.9z" fill="currentColor" />
    </svg>
  );
}

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <path
        d="M3.5 2.5h5.2L11 4.8V11.5H3.5V2.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8.5 2.5V5H11" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 7.5h4M5 9.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <path
        d="M3 4l3.5 3L3 10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 10h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M7 4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="10.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <path
        d="M3 7.2l2.6 2.6L11 4.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function ModeIcon({ mode, className }: { mode: FlowBarMode; className?: string }) {
  if (mode === "dictation") return <MicIcon className={className} />;
  if (mode === "transform") return <WandIcon className={className} />;
  if (mode === "meeting") {
    return (
      <span className={`relative flex h-3 w-3 items-center justify-center ${className ?? ""}`}>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
      </span>
    );
  }
  return <ChevronIcon className={className} />;
}

/** The core indicator: mode glyph at rest, waveform/spinner/check/alert while active. */
function IndicatorCore({ mode, phase }: { mode: FlowBarMode; phase: FlowBarPhase }) {
  const accent = MODE_ACCENT[mode];

  if (mode === "meeting" && (phase === "listening" || phase === "processing")) {
    return (
      <span className="relative flex h-4 w-4 items-center justify-center">
        <span className="absolute inline-flex h-3.5 w-3.5 animate-ping rounded-full bg-rose-500/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-400" />
      </span>
    );
  }

  if (phase === "listening") {
    return (
      <div className={`flex h-4 items-end gap-[2.5px] ${accent.fg}`}>
        {[6, 10, 14, 9, 5].map((h, i) => (
          <span
            key={i}
            className="flowbar-wave-bar block w-[2.5px] rounded-full bg-current"
            style={{ height: `${h}px` }}
          />
        ))}
      </div>
    );
  }

  if (phase === "processing") {
    return (
      <span
        className={`flowbar-spin block h-4 w-4 rounded-full border-[1.6px] border-current/25 border-t-current ${accent.fg}`}
      />
    );
  }

  if (phase === "result") {
    return (
      <span className="flowbar-pop flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <CheckIcon className="h-3 w-3" />
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="flowbar-shake flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-amber-400">
        <AlertIcon className="h-3 w-3" />
      </span>
    );
  }

  return (
    <span className={`flex h-4 w-4 items-center justify-center opacity-70 ${accent.fg}`}>
      <ModeIcon mode={mode} className="h-3.5 w-3.5" />
    </span>
  );
}

export function FlowBar({
  mode,
  phase,
  statusText,
  hotkeyHint,
  languageCode,
  languageBusy,
  onOpenLanguageMenu,
  onOpenScratchpad,
  onStartTransform,
  onStopMeeting,
  sessionBadge,
  detectedLanguageBadge,
  meetingSnippet,
}: Props) {
  const accent = MODE_ACCENT[mode];
  const badgeCode = languageCode === "auto" ? "AUTO" : languageCode.toUpperCase();
  const actionsDisabled = phase === "processing";
  const isMeeting = mode === "meeting";

  return (
    <div
      className="drag-region flex h-full w-full items-center justify-center"
      title={hotkeyHint}
    >
      <div
        className={`flowbar flex items-center gap-2 rounded-[14px] border bg-zinc-950/95 px-3 py-2 backdrop-blur-xl ${accent.ring} ${accent.glow}`}
        style={{ fontFamily: "var(--font-hud)" }}
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${accent.ring} bg-black/40`}
        >
          <IndicatorCore mode={mode} phase={phase} />
        </span>

        <div className="flex min-w-0 flex-col">
          <span
            className={`max-w-[140px] truncate text-[10.5px] font-medium tracking-[0.08em] uppercase ${
              phase === "error" ? "text-amber-300" : isMeeting ? "text-rose-200" : "text-zinc-200"
            }`}
          >
            {statusText}
          </span>
          {isMeeting && meetingSnippet ? (
            <span className="max-w-[160px] truncate text-[9px] normal-case tracking-normal text-zinc-500">
              {meetingSnippet}
            </span>
          ) : null}
        </div>

        <span className="mx-0.5 h-4 w-px shrink-0 bg-zinc-800" />

        {isMeeting ? (
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={onStopMeeting}
            title="Stop meeting recording (Ctrl+Shift+M)"
            className="no-drag flex h-6 items-center gap-1 rounded-md bg-rose-500/15 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-rose-300 transition hover:bg-rose-500/25 disabled:opacity-40"
          >
            <StopIcon className="h-3 w-3" />
            Stop
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={languageBusy}
              onClick={onOpenLanguageMenu}
              title="Dictation language — click to change"
              className="no-drag shrink-0 rounded-md px-1 text-[10px] font-semibold tracking-wide text-zinc-500 transition hover:text-violet-300 disabled:opacity-50"
            >
              {badgeCode}
            </button>

            <button
              type="button"
              disabled={actionsDisabled}
              onClick={onOpenScratchpad}
              title="Scratchpad — open a note and dictate into it"
              className="no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-emerald-300 disabled:opacity-40"
            >
              <NoteIcon className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              disabled={actionsDisabled}
              onClick={onStartTransform}
              title="Transforms — select text first, then rewrite by voice (F9)"
              className="no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-40"
            >
              <WandIcon className="h-3.5 w-3.5" />
            </button>
          </>
        )}

        {sessionBadge ? (
          <span
            className="shrink-0 whitespace-nowrap text-[9px] text-zinc-600"
            title="Dictation session — utterances · time left"
          >
            {sessionBadge}
          </span>
        ) : null}

        {detectedLanguageBadge ? (
          <span
            className="shrink-0 whitespace-nowrap text-[9px] text-zinc-600"
            title="Language Whisper detected for this utterance"
          >
            {detectedLanguageBadge}
          </span>
        ) : null}
      </div>
    </div>
  );
}
