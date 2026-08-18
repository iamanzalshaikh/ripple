import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { LANGUAGES } from "../lib/languages";
import { Card, PageHeader, PrimaryButton, TextInput, ToggleSwitch } from "../components/theme/ui";
import { CheckIcon } from "../components/theme/icons";
import { MicDeviceSettings } from "../components/MicDeviceSettings";
import { CleanupPipelineSettings } from "../components/CleanupPipelineSettings";

interface Props {
  onBack: () => void;
}

/**
 * P9.5 — dictation language picker. "auto" (default) matches today's
 * behavior: no language hint is sent, Whisper auto-detects. Picking a
 * language sends it as a per-request override on every future utterance
 * without needing to restart the app.
 */

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
    <div className="min-h-full bg-onboard-bg">
      <PageHeader
        title="Language"
        subtitle="The language Ripple expects when transcribing your dictation."
        onBack={onBack}
      />

      <main className="mx-auto max-w-2xl p-8">
        <Card>
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
            Dictation language
          </h3>
          <p className="mt-1 text-xs text-onboard-muted">
            Auto-detect works well for Hinglish and code-switching. Pick a
            specific language if Whisper keeps mis-detecting yours.
          </p>
          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
          {loading ? (
            <p className="mt-4 text-sm text-onboard-muted">Loading…</p>
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
                        ? "border-onboard-accent bg-onboard-accent/10 text-onboard-ink"
                        : "border-onboard-border bg-onboard-surface text-onboard-ink hover:border-onboard-accent/40"
                    }`}
                  >
                    {lang.label}
                    {active ? (
                      <CheckIcon
                        width={12}
                        height={12}
                        className="ml-1.5 inline text-onboard-accent-hover"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="mt-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
            Other language
          </h3>
          <p className="mt-1 text-xs text-onboard-muted">
            Whisper supports many more languages than are listed above — enter
            an ISO 639-1 code (e.g. "it" for Italian, "nl" for Dutch).
            {!known && !loading ? (
              <span className="mt-1 block text-onboard-accent-hover">
                Currently set to a custom code: "{current}"
              </span>
            ) : null}
          </p>
          <div className="mt-3 flex gap-2">
            <TextInput
              type="text"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void selectLanguage(customCode.trim().toLowerCase());
              }}
              placeholder="e.g. it"
              maxLength={8}
              className="flex-1"
            />
            <PrimaryButton
              disabled={busy || !customCode.trim()}
              onClick={() => void selectLanguage(customCode.trim().toLowerCase())}
            >
              Set
            </PrimaryButton>
          </div>
        </Card>

        <Card className="mt-6">
          <CleanupPipelineSettings />
        </Card>

        <Card className="mt-6">
          <MicDeviceSettings />
        </Card>

        <Card className="mt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
                Quiet / whisper mode
              </h3>
              <p className="mt-1 text-xs text-onboard-muted">
                Boosts soft or whispered speech before it's sent for
                transcription, and turns off noise suppression, which
                otherwise tends to treat quiet speech as background noise.
                Leave off for normal-volume speaking.
              </p>
            </div>
            <ToggleSwitch
              checked={quietMode}
              onChange={() => void toggleQuietMode()}
              label="Quiet / whisper mode"
              disabled={quietBusy || quietLoading}
            />
          </div>
          {quietError ? (
            <p className="mt-3 text-xs text-red-600">{quietError}</p>
          ) : null}
        </Card>
      </main>
    </div>
  );
}
