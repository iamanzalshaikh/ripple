import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { Card, PageHeader, PrimaryButton } from "../components/theme/ui";

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
    <div className="min-h-full bg-onboard-bg">
      <PageHeader
        title="Snippets"
        subtitle="Say the trigger phrase while dictating and it expands verbatim — no cleanup, no rewriting."
        onBack={onBack}
      />

      <main className="mx-auto max-w-2xl p-8">
        <Card className="border-onboard-accent/30 bg-onboard-accent/5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-accent-hover">
            Add a snippet
          </h3>
          <p className="mt-1 text-xs text-onboard-muted">
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
              placeholder="Trigger (e.g. sig)"
              className="rounded-lg border border-onboard-border bg-onboard-surface px-3 py-2 text-sm text-onboard-ink placeholder:text-onboard-subtle outline-none focus:border-onboard-accent"
            />
            <textarea
              value={expansion}
              onChange={(e) => setExpansion(e.target.value)}
              placeholder="Expands to…"
              rows={3}
              className="rounded-lg border border-onboard-border bg-onboard-surface px-3 py-2 text-sm text-onboard-ink placeholder:text-onboard-subtle outline-none focus:border-onboard-accent"
            />
            <PrimaryButton
              type="submit"
              disabled={busy || !trigger.trim() || !expansion.trim()}
              className="self-start"
            >
              Add
            </PrimaryButton>
          </form>
          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        </Card>

        <Card className="mt-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
            Your snippets ({items.length})
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-onboard-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-onboard-muted">
              No snippets yet — add one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.trigger}
                  className="flex items-start justify-between gap-3 rounded-lg border border-onboard-border bg-onboard-surface px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-onboard-ink">
                      {item.trigger}
                    </p>
                    <p className="mt-1 text-xs text-onboard-muted line-clamp-2">
                      {item.expansion}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEntry(item.trigger)}
                    className="shrink-0 text-xs text-onboard-subtle transition hover:text-red-600 disabled:opacity-50"
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
