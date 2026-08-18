import { useEffect } from "react";
import { useHistoryStore } from "../store/historyStore";
import { BackLink, SecondaryButton } from "../components/theme/ui";

const INTENTS = [
  "",
  "generation",
  "edit",
  "navigation",
  "typing",
  "workflow",
  "undo",
];

interface Props {
  onBack: () => void;
}

export function HistoryPage({ onBack }: Props) {
  const {
    items,
    total,
    page,
    limit,
    loading,
    error,
    intentFilter,
    setIntentFilter,
    fetch,
  } = useHistoryStore();

  useEffect(() => {
    void fetch(1);
  }, [fetch]);

  function applyFilter(intent: string) {
    setIntentFilter(intent);
    void fetch(1);
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <BackLink onClick={onBack}>Dashboard</BackLink>
          <h2 className="mt-2 text-xl font-semibold text-onboard-ink">
            Dictation history
          </h2>
          <p className="text-sm text-onboard-subtle">{total} entries</p>
        </div>
        <SecondaryButton
          onClick={() => void fetch(page)}
          disabled={loading}
          className="px-3 py-1.5"
        >
          Refresh
        </SecondaryButton>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {INTENTS.map((intent) => (
          <button
            key={intent || "all"}
            type="button"
            onClick={() => applyFilter(intent)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              intentFilter === intent
                ? "bg-onboard-accent text-white"
                : "bg-onboard-surface text-onboard-muted hover:bg-onboard-card-soft"
            }`}
          >
            {intent || "All"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <p className="text-sm text-onboard-muted">Loading…</p>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-2xl border border-onboard-border bg-onboard-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-onboard-ink">{item.command}</p>
              <span className="shrink-0 rounded-full bg-onboard-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase text-onboard-accent-hover">
                {item.intent}
              </span>
            </div>
            {item.result ? (
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-onboard-muted">
                {item.result}
              </p>
            ) : null}
            <p className="mt-2 text-[10px] text-onboard-subtle">
              {new Date(item.created_at).toLocaleString()}
              {item.action_source ? ` · ${item.action_source}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {total > items.length ? (
        <div className="mt-6 flex justify-center gap-2">
          <SecondaryButton
            disabled={page <= 1 || loading}
            onClick={() => void fetch(page - 1)}
            className="px-3 py-1.5"
          >
            Previous
          </SecondaryButton>
          <span className="px-2 py-1.5 text-sm text-onboard-muted">
            Page {page}
          </span>
          <SecondaryButton
            disabled={page * limit >= total || loading}
            onClick={() => void fetch(page + 1)}
            className="px-3 py-1.5"
          >
            Next
          </SecondaryButton>
        </div>
      ) : null}
    </div>
  );
}
