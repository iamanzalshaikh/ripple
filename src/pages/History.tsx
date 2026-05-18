import { useEffect } from "react";
import { useHistoryStore } from "../store/historyStore";

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
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-violet-400 hover:text-violet-300"
          >
            ← Dashboard
          </button>
          <h2 className="mt-2 text-xl font-semibold">Command history</h2>
          <p className="text-sm text-zinc-500">{total} commands total</p>
        </div>
        <button
          type="button"
          onClick={() => void fetch(page)}
          disabled={loading}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {INTENTS.map((intent) => (
          <button
            key={intent || "all"}
            type="button"
            onClick={() => applyFilter(intent)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              intentFilter === intent
                ? "bg-violet-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {intent || "All"}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100">{item.command}</p>
              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] uppercase text-violet-300">
                {item.intent}
              </span>
            </div>
            {item.result ? (
              <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-400">
                {item.result}
              </p>
            ) : null}
            <p className="mt-2 text-[10px] text-zinc-600">
              {new Date(item.created_at).toLocaleString()}
              {item.action_source ? ` · ${item.action_source}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {total > items.length ? (
        <div className="mt-6 flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => void fetch(page - 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-2 py-1.5 text-sm text-zinc-500">
            Page {page}
          </span>
          <button
            type="button"
            disabled={page * limit >= total || loading}
            onClick={() => void fetch(page + 1)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
