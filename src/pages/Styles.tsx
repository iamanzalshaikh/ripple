import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";

interface Props {
  onBack: () => void;
}

type Tone = "professional" | "casual" | "neutral";

type Entry = {
  processName: string;
  tone: Tone;
  updatedAt: string;
};

const TONES: Tone[] = ["neutral", "professional", "casual"];

/**
 * Wispr-Flow plan Phase 7.3 — per-app ambient dictation tone.
 * English + desktop first, per the plan's own note — this is process-name
 * based (Notepad, Cursor, chrome, …), not per-website.
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
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Styles</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Set a default dictation tone per app — applies automatically,
            without saying "make it professional" each time.
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
        <section className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-violet-300">
            Set a tone
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            App/process name as it appears in the taskbar, e.g. "notepad",
            "cursor", "chrome".
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
              placeholder="Process name (e.g. cursor)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as Tone)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !processName.trim()}
              onClick={() => void saveEntry()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              Save
            </button>
          </div>
          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            App tones ({items.length})
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-zinc-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No app tones set — everything uses neutral (as-spoken) by
              default.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.processName}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-2.5"
                >
                  <span className="text-sm text-zinc-200">
                    <span className="font-medium">{item.processName}</span>
                    <span className="mx-2 text-zinc-600">→</span>
                    <span className="text-zinc-400">{item.tone}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEntry(item.processName)}
                    className="text-xs text-zinc-500 transition hover:text-red-400 disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
