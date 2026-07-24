import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";

interface Props {
  onBack: () => void;
}

type Entry = {
  trigger: string;
  expansion: string;
  createdAt: string;
  updatedAt: string;
};

/** Wispr-Flow plan Phase 7.2 — voice-triggered text expansion shortcuts. */
export function SnippetsPage({ onBack }: Props) {
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [trigger, setTrigger] = useState("");
  const [expansion, setExpansion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getRippleApi().snippets.list();
      setItems(res.ok ? (res.items ?? []) : []);
      if (!res.ok) setError(res.message ?? "Failed to load snippets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addEntry() {
    const t = trigger.trim();
    const e = expansion.trim();
    if (!t || !e || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().snippets.add({ trigger: t, expansion: e });
      if (!res.ok) {
        setError(res.message ?? "Failed to add snippet");
        return;
      }
      setTrigger("");
      setExpansion("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(t: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().snippets.remove(t);
      if (!res.ok) {
        setError(res.message ?? "Failed to remove snippet");
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
          <h1 className="text-2xl font-semibold tracking-tight">Snippets</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Say the trigger phrase while dictating and it expands verbatim —
            no cleanup, no rewriting.
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
            Add a snippet
          </h3>
          <p className="mt-1 text-xs text-zinc-400">
            Say only the trigger while dictating (e.g. say &quot;sig&quot;, not
            the full signature). Whole utterance must match.
          </p>
          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addEntry();
            }}
          >
            <input
              type="text"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder='Trigger (e.g. sig)'
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <textarea
              value={expansion}
              onChange={(e) => setExpansion(e.target.value)}
              placeholder="Expands to…"
              rows={3}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !trigger.trim() || !expansion.trim()}
              className="self-start rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
        </section>

        <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-400">
            Your snippets ({items.length})
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-zinc-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-500">
              No snippets yet — add one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.trigger}
                  className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200">
                      {item.trigger}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
                      {item.expansion}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEntry(item.trigger)}
                    className="shrink-0 text-xs text-zinc-500 transition hover:text-red-400 disabled:opacity-50"
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
