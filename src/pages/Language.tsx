import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";

interface Props {
  onBack: () => void;
}

/**
 * P9.5 — dictation language picker. "auto" (default) matches today's
 * behavior: no language hint is sent, Whisper auto-detects. Picking a
 * language sends it as a per-request override on every future utterance
 * without needing to restart the app.
 */
const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "ur", label: "Urdu" },
  { code: "ta", label: "Tamil" },
  { code: "si", label: "Sinhala" },
  { code: "bn", label: "Bengali" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ru", label: "Russian" },
];

export function LanguagePage({ onBack }: Props) {
  const [current, setCurrent] = useState<string>("auto");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customCode, setCustomCode] = useState("");

  const [quietMode, setQuietMode] = useState(false);
  const [quietLoading, setQuietLoading] = useState(true);
  const [quietBusy, setQuietBusy] = useState(false);
  const [quietError, setQuietError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getRippleApi().language.get();
      setCurrent(res.ok && res.language ? res.language : "auto");
      if (!res.ok) setError(res.message ?? "Failed to load language setting");
    } finally {
      setLoading(false);
    }
  }

  async function refreshQuietMode() {
    setQuietLoading(true);
    try {
      const res = await getRippleApi().quietMode.get();
      setQuietMode(res.ok && res.quietMode === true);
      if (!res.ok) setQuietError(res.message ?? "Failed to load quiet mode setting");
    } finally {
      setQuietLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    void refreshQuietMode();
  }, []);

  async function toggleQuietMode() {
    if (quietBusy) return;
    setQuietBusy(true);
    setQuietError(null);
    const next = !quietMode;
    try {
      const res = await getRippleApi().quietMode.set(next);
      if (!res.ok) {
        setQuietError(res.message ?? "Failed to save quiet mode");
        return;
      }
      setQuietMode(res.quietMode ?? next);
    } finally {
      setQuietBusy(false);
    }
  }

  async function selectLanguage(code: string) {
    if (busy || code === current) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().language.set(code);
      if (!res.ok) {
        setError(res.message ?? "Failed to save language");
        return;
      }
      setCurrent(res.language ?? code);
    } finally {
      setBusy(false);
    }
  }

  const known = LANGUAGES.some((l) => l.code === current);

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Language</h1>
          <p className="mt-1 text-sm text-zinc-400">
            The language Ripple expects when transcribing your dictation.
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-900"
        >
          Back
        </button>
      </header>

      <main className="mx-auto max-w-2xl p-8">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Dictation language
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Auto-detect works well for Hinglish and code-switching. Pick a
            specific language if Whisper keeps mis-detecting yours.
          </p>
          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
          {loading ? (
            <p className="mt-4 text-sm text-zinc-500">Loading…</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((lang) => {
                const active = lang.code === current;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    disabled={busy}
                    onClick={() => void selectLanguage(lang.code)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                      active
                        ? "border-violet-500 bg-violet-950/40 text-white"
                        : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600"
                    }`}
                  >
                    {lang.label}
                    {active ? (
                      <span className="ml-1.5 text-xs text-violet-400">✓</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Other language
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Whisper supports many more languages than are listed above — enter
            an ISO 639-1 code (e.g. "it" for Italian, "nl" for Dutch).
            {!known && !loading ? (
              <span className="mt-1 block text-violet-400">
                Currently set to a custom code: "{current}"
              </span>
            ) : null}
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void selectLanguage(customCode.trim().toLowerCase());
              }}
              placeholder="e.g. it"
              maxLength={8}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !customCode.trim()}
              onClick={() => void selectLanguage(customCode.trim().toLowerCase())}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              Set
            </button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
                Quiet / whisper mode
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Boosts soft or whispered speech before it's sent for
                transcription, and turns off noise suppression, which
                otherwise tends to treat quiet speech as background noise.
                Leave off for normal-volume speaking.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={quietMode}
              disabled={quietBusy || quietLoading}
              onClick={() => void toggleQuietMode()}
              className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
                quietMode ? "bg-violet-600" : "bg-zinc-700"
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                  quietMode ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          {quietError ? (
            <p className="mt-3 text-xs text-red-400">{quietError}</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
