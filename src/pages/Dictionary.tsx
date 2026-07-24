import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";

interface Props {
  onBack: () => void;
}

type Entry = {
  spokenForm: string;
  canonicalForm: string;
  source: string;
  updatedAt: string;
};

/** Wispr-Flow plan Phase 7.4 — manual CRUD over the personal dictionary. */
export function DictionaryPage({ onBack }: Props) {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [spokenForm, setSpokenForm] = useState("");
  const [canonicalForm, setCanonicalForm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getRippleApi().dictionary.list();
      setItems(res.ok ? (res.items ?? []) : []);
      if (!res.ok) setError(res.message ?? "Failed to load dictionary");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addEntry() {
    const spoken = spokenForm.trim();
    const canonical = canonicalForm.trim();
    if (!spoken || !canonical || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().dictionary.add({
        spokenForm: spoken,
        canonicalForm: canonical,
      });
      if (!res.ok) {
        setError(res.message ?? "Failed to add entry");
        return;
      }
      setSpokenForm("");
      setCanonicalForm("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(spoken: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().dictionary.remove(spoken);
      if (!res.ok) {
        setError(res.message ?? "Failed to remove entry");
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
          <h1 className="text-2xl font-semibold tracking-tight">Dictionary</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Words and names Ripple has learned to correct in dictation.
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
            Add a correction
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            e.g. spoken "nor" → corrects to "Noor" everywhere in dictation.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={spokenForm}
              onChange={(e) => setSpokenForm(e.target.value)}
              placeholder="Spoken (e.g. nor)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <input
              type="text"
              value={canonicalForm}
              onChange={(e) => setCanonicalForm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addEntry();
              }}
              placeholder="Corrects to (e.g. Noor)"
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !spokenForm.trim() || !canonicalForm.trim()}
              onClick={() => void addEntry()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Learned corrections ({items.length})
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-zinc-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No corrections learned yet. Say "X means Y" while dictating, or
              add one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.spokenForm}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-2.5"
                >
                  <span className="text-sm text-zinc-200">
                    <span className="text-zinc-400">{item.spokenForm}</span>
                    <span className="mx-2 text-zinc-600">→</span>
                    <span className="font-medium">{item.canonicalForm}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEntry(item.spokenForm)}
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
