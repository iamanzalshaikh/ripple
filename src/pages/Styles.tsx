import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { Card, PageHeader, PrimaryButton, TextInput } from "../components/theme/ui";

interface Props {
  onBack: () => void;
}

type Tone =
  | "very_casual"
  | "casual"
  | "neutral"
  | "professional"
  | "formal";

type Entry = {
  processName: string;
  tone: Tone;
  updatedAt: string;
};

const TONE_SCALE: Array<{ id: Tone; label: string; hint: string }> = [
  { id: "very_casual", label: "Very Casual", hint: "Hey / gotta" },
  { id: "casual", label: "Casual", hint: "Friendly" },
  { id: "neutral", label: "Neutral", hint: "As spoken" },
  { id: "professional", label: "Professional", hint: "Polished" },
  { id: "formal", label: "Formal", hint: "Email / docs" },
];

const TONE_LABEL: Record<Tone, string> = {
  very_casual: "Very Casual",
  casual: "Casual",
  neutral: "Neutral",
  professional: "Professional",
  formal: "Formal",
};

/**
 * Wispr-Flow plan Phase 7.3 — per-app ambient dictation tone.
 * Very Casual → Formal scale, keyed by process name (notepad, cursor, chrome).
 */
export function StylesPage({ onBack }: Props) {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [processName, setProcessName] = useState("");
  const [tone, setTone] = useState<Tone>("professional");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getRippleApi().styles.list();
      setItems(res.ok ? (res.items ?? []) : []);
      if (!res.ok) setError(res.message ?? "Failed to load styles");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function saveEntry() {
    const name = processName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().styles.set({ processName: name, tone });
      if (!res.ok) {
        setError(res.message ?? "Failed to save style");
        return;
      }
      setProcessName("");
      setTone("professional");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(name: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().styles.remove(name);
      if (!res.ok) {
        setError(res.message ?? "Failed to remove style");
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-onboard-bg">
      <PageHeader
        title="Styles"
        subtitle="Default dictation tone per app — Very Casual through Formal. Applies automatically; no need to say “make it professional” each time."
        onBack={onBack}
      />

      <main className="mx-auto max-w-2xl p-8">
        <Card className="border-onboard-accent/30 bg-onboard-accent/5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-accent-hover">
            Set a tone
          </h3>
          <p className="mt-1 text-xs text-onboard-muted">
            App/process name as it appears in the taskbar, e.g. "notepad",
            "cursor", "chrome". Neutral means as-spoken (no override).
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <TextInput
              type="text"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
              placeholder="Process name (e.g. cursor)"
            />
            <div
              className="grid grid-cols-5 gap-1 rounded-xl border border-onboard-border bg-onboard-surface p-1"
              role="radiogroup"
              aria-label="Tone scale"
            >
              {TONE_SCALE.map((step) => {
                const selected = tone === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTone(step.id)}
                    className={`rounded-lg px-1 py-2 text-center transition ${
                      selected
                        ? "bg-onboard-accent text-white shadow-sm"
                        : "text-onboard-muted hover:bg-onboard-card-soft hover:text-onboard-ink"
                    }`}
                  >
                    <span className="block text-[11px] font-medium leading-tight">
                      {step.label}
                    </span>
                    <span
                      className={`mt-0.5 block text-[9px] leading-tight ${
                        selected ? "text-white/80" : "text-onboard-subtle"
                      }`}
                    >
                      {step.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <PrimaryButton
              disabled={busy || !processName.trim()}
              onClick={() => void saveEntry()}
            >
              Save
            </PrimaryButton>
          </div>
          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        </Card>

        <Card className="mt-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
            App tones ({items.length})
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-onboard-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-onboard-muted">
              No app tones set — everything uses Neutral (as-spoken) by
              default.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.processName}
                  className="flex items-center justify-between gap-3 rounded-lg border border-onboard-border bg-onboard-surface px-4 py-2.5"
                >
                  <span className="text-sm text-onboard-ink">
                    <span className="font-medium">{item.processName}</span>
                    <span className="mx-2 text-onboard-subtle">→</span>
                    <span className="text-onboard-muted">
                      {TONE_LABEL[item.tone] ?? item.tone}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEntry(item.processName)}
                    className="text-xs text-onboard-subtle transition hover:text-red-600 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}
