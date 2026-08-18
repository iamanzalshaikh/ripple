import { useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { Card, PageHeader, PrimaryButton, TextInput } from "../components/theme/ui";

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
    <div className="min-h-full bg-onboard-bg">
      <PageHeader
        title="Dictionary"
        subtitle="Words and names Ripple has learned to correct in dictation."
        onBack={onBack}
      />

      <main className="mx-auto max-w-2xl p-8">
        <Card className="border-onboard-accent/30 bg-onboard-accent/5">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-accent-hover">
            Add a correction
          </h3>
          <p className="mt-1 text-xs text-onboard-muted">
            e.g. spoken "nor" → corrects to "Noor" everywhere in dictation.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <TextInput
              type="text"
              value={spokenForm}
              onChange={(e) => setSpokenForm(e.target.value)}
              placeholder="Spoken (e.g. nor)"
              className="sm:flex-1"
            />
            <TextInput
              type="text"
              value={canonicalForm}
              onChange={(e) => setCanonicalForm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addEntry();
              }}
              placeholder="Corrects to (e.g. Noor)"
              className="sm:flex-1"
            />
            <PrimaryButton
              disabled={busy || !spokenForm.trim() || !canonicalForm.trim()}
              onClick={() => void addEntry()}
            >
              Add
            </PrimaryButton>
          </div>
          {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        </Card>

        <Card className="mt-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
            Learned corrections ({items.length})
          </h3>
          {loading ? (
            <p className="mt-4 text-sm text-onboard-muted">Loading…</p>
          ) : items.length === 0 ? (
            <p className="mt-4 text-sm text-onboard-muted">
              No corrections learned yet. Say "X means Y" while dictating, or
              add one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li
                  key={item.spokenForm}
                  className="flex items-center justify-between gap-3 rounded-lg border border-onboard-border bg-onboard-surface px-4 py-2.5"
                >
                  <span className="text-sm text-onboard-ink">
                    <span className="text-onboard-muted">{item.spokenForm}</span>
                    <span className="mx-2 text-onboard-subtle">→</span>
                    <span className="font-medium">{item.canonicalForm}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeEntry(item.spokenForm)}
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
