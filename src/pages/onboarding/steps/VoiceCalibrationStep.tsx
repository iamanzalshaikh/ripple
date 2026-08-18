import { useState } from "react";
import { useVoiceCapture } from "../../../hooks/useVoiceCapture";
import { BigCheckIcon, HelpCircleIcon, MicIcon, WaveformIcon } from "../../../components/theme/icons";
import { GhostLink, PrimaryButton, StepBadge } from "../../../components/theme/ui";

interface Props {
  totalSteps: number;
  onContinue: () => void;
  onSkip: () => void;
}

const PROMPTS = [
  "Hello, how are you today?",
  "Please send the meeting notes after lunch.",
  "The project deadline is Friday at three.",
];

type PromptState = "pending" | "recording" | "done";

export function VoiceCalibrationStep({ totalSteps, onContinue, onSkip }: Props) {
  const capture = useVoiceCapture();
  const [active, setActive] = useState(0);
  const [states, setStates] = useState<PromptState[]>(
    PROMPTS.map(() => "pending"),
  );
  const [showComplete, setShowComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRecording = states[active] === "recording";
  const isLast = active === PROMPTS.length - 1;

  async function toggleRecord() {
    setError(null);
    if (isRecording) {
      try {
        await capture.stop();
      } catch {
        /* discard */
      }
      setStates((prev) => {
        const next = [...prev];
        next[active] = "done";
        return next;
      });
      if (isLast) {
        setShowComplete(true);
      } else {
        setActive((a) => a + 1);
      }
      return;
    }

    try {
      await capture.start();
      setStates((prev) => {
        const next = [...prev];
        next[active] = "recording";
        return next;
      });
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't start the microphone for this prompt.",
      );
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
        <div>
          <StepBadge step={3} total={totalSteps} label="Voice calibration" />
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-onboard-ink">
            Say a few things so Ripple learns your voice.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-onboard-muted">
            This takes about 60 seconds. Speak naturally — don't slow down or
            over-enunciate. Ripple works best when it hears the way you
            actually talk.
          </p>

          <ol className="mt-8 flex flex-col gap-0">
            {PROMPTS.map((_, i) => (
              <li key={i} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                      states[i] === "done"
                        ? "bg-onboard-success text-white"
                        : i === active
                          ? "bg-onboard-accent text-white"
                          : "bg-onboard-border text-onboard-muted"
                    }`}
                  >
                    {states[i] === "done" ? <BigCheckIcon width={14} height={14} strokeWidth={3} /> : i + 1}
                  </span>
                  {i < PROMPTS.length - 1 ? (
                    <span className="h-8 w-px bg-onboard-border" />
                  ) : null}
                </div>
                <span
                  className={`pb-8 text-base ${
                    i === active ? "text-onboard-ink" : "text-onboard-muted"
                  }`}
                >
                  Prompt {i + 1}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <div className="overflow-hidden rounded-2xl border border-onboard-border bg-onboard-card">
            <div className="border-b border-onboard-border-soft px-6 py-4 text-center text-xs font-semibold uppercase tracking-wide text-onboard-subtle">
              Prompt {active + 1} of {PROMPTS.length}
            </div>
            <div className="flex flex-col items-center px-8 py-14 text-center">
              <p className="text-2xl font-semibold leading-snug text-onboard-ink">
                &ldquo;{PROMPTS[active]}&rdquo;
              </p>

              <div className="mt-8 text-onboard-accent">
                <WaveformIcon
                  className={isRecording ? "flowbar-wave-bar" : ""}
                />
              </div>

              <button
                type="button"
                onClick={() => void toggleRecord()}
                className={`mt-8 flex h-16 w-16 items-center justify-center rounded-full shadow-sm transition ${
                  isRecording
                    ? "bg-onboard-accent text-white"
                    : "bg-onboard-surface text-onboard-accent"
                }`}
              >
                <MicIcon />
              </button>
              <p className="mt-4 text-sm text-onboard-ink">
                {isRecording ? "Listening…" : "Tap to record"}
              </p>
              {error ? (
                <p className="mt-2 text-sm text-red-500">{error}</p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            {PROMPTS.slice(1).map((p, i) => {
              const idx = i + 1;
              return (
                <div
                  key={idx}
                  className={`rounded-xl border bg-onboard-surface p-4 transition ${
                    idx === active
                      ? "border-onboard-accent"
                      : "border-onboard-border"
                  }`}
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-onboard-subtle">
                    Prompt {idx + 1}
                  </p>
                  <p className="mt-1 truncate text-sm text-onboard-ink">
                    &ldquo;{p.slice(0, 22)}…&rdquo;
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-10 flex items-center justify-center gap-1.5">
        <GhostLink onClick={onSkip}>
          Skip calibration — I'll do this later in Settings
        </GhostLink>
        <HelpCircleIcon className="text-onboard-subtle" />
      </div>

      {showComplete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-onboard-ink/40 backdrop-blur-sm">
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-onboard-surface text-center shadow-xl">
            <div className="h-1.5 w-full bg-onboard-accent" />
            <div className="flex flex-col items-center px-8 py-10">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-onboard-success-soft text-onboard-success">
                <BigCheckIcon />
              </span>
              <h2 className="mt-5 text-xl font-bold text-onboard-ink">
                Voice profile created
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-onboard-muted">
                Ripple is now securely calibrated to your unique voice
                signature.
              </p>
              <PrimaryButton
                withArrow
                onClick={onContinue}
                className="mt-6 w-full py-3"
              >
                Continue
              </PrimaryButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
