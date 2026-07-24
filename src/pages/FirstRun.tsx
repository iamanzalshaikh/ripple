import { useState } from "react";

interface Props {
  onDone: () => void;
}

/**
 * Wispr-Flow plan Phase 5 — thin product shell.
 * Shown once per device before the dashboard: how to dictate, what's sent to
 * the cloud, and what isn't proven yet. Not the polished Flow Bar (Phase 11)
 * — just enough for a stranger to succeed in ~2 minutes.
 */
export function FirstRunPage({ onDone }: Props) {
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Dictate anywhere",
      body: (
        <>
          <p className="text-sm leading-relaxed text-zinc-300">
            Click into any text field — Notepad, Cursor, WhatsApp, Gmail — then
            hold{" "}
            <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs">
              Alt
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs">
              Space
            </kbd>{" "}
            and speak. Release when you're done — your words appear, cleaned
            up, right where your cursor is.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs">
              Ctrl
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs">
              Space
            </kbd>{" "}
            is a different mode — commands like "open Chrome," not dictation.
          </p>
        </>
      ),
    },
    {
      title: "Privacy",
      body: (
        <>
          <p className="text-sm leading-relaxed text-zinc-300">
            Your speech is sent to the cloud to be transcribed — it needs an
            internet connection to work at all.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-300">
            Ripple does not take silent background screenshots. Screen reading
            only happens when you explicitly ask for an on-screen action.
          </p>
        </>
      ),
    },
    {
      title: "Known limits, today",
      body: (
        <ul className="mt-1 space-y-2 text-sm leading-relaxed text-zinc-300">
          <li>• Windows only for now.</li>
          <li>• Elevated / admin windows aren't supported.</li>
          <li>
            • Reliable today in: Notepad, Cursor, WhatsApp Web, Gmail. Other
            apps may work but aren't guaranteed yet.
          </li>
        </ul>
      ),
    },
  ];

  const isLast = step === steps.length - 1;
  const current = steps[step]!;

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 p-8">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
        <p className="text-xs uppercase tracking-wide text-violet-400">
          Welcome to Ripple · {step + 1}/{steps.length}
        </p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">
          {current.title}
        </h1>
        <div className="mt-4">{current.body}</div>

        <div className="mt-8 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="text-sm text-zinc-500 transition hover:text-zinc-300 disabled:opacity-0"
          >
            Back
          </button>
          <button
            type="button"
            data-testid="firstrun-next"
            onClick={() => (isLast ? onDone() : setStep((s) => s + 1))}
            className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
          >
            {isLast ? "Got it — let's go" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
