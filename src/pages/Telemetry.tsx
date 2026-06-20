import { useCallback, useEffect, useState } from "react";

type Summary = NonNullable<
  Awaited<ReturnType<RippleApi["getTelemetrySummary"]>>["summary"]
>;

interface Props {
  onBack: () => void;
}

export function TelemetryPage({ onBack }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await window.ripple.getTelemetrySummary();
    if (!res.ok || !res.summary) {
      setError(res.message ?? "Could not load telemetry");
      setSummary(null);
    } else {
      setSummary(res.summary);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleExport() {
    const res = await window.ripple.exportTelemetryCsv();
    if (!res.ok || !res.csv) {
      setError(res.message ?? "Export failed");
      return;
    }
    const blob = new Blob([res.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ripple-telemetry-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const mixTotal =
    (summary?.plannerMix.offline ?? 0) +
    (summary?.plannerMix.gpt ?? 0) +
    (summary?.plannerMix.fast ?? 0) +
    (summary?.plannerMix.graph ?? 0);

  function mixPercent(n: number): string {
    if (!mixTotal) return "0%";
    return `${Math.round((n / mixTotal) * 100)}%`;
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
          <h2 className="mt-2 text-xl font-semibold">Observability</h2>
          <p className="text-sm text-zinc-500">
            P6 telemetry — last {summary?.total ?? 0} events
            {summary?.avgLatencyMs ? ` · avg ${summary.avgLatencyMs}ms` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            className="rounded-lg border border-violet-600/50 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-950/40"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-red-400">{error}</p>
      ) : null}

      {loading && !summary ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : summary ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-300">Success rate</h3>
            <p className="mt-2 text-3xl font-semibold text-emerald-400">
              {summary.successRatePercent}%
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              7-day rolling: {summary.rolling7DaySuccessRate}%
            </p>
            <ul className="mt-4 space-y-1 text-xs text-zinc-400">
              {Object.entries(summary.byOutcome).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="text-zinc-200">{v}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-300">Planner mix</h3>
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              <li className="flex justify-between">
                <span>Fast path</span>
                <span>{mixPercent(summary.plannerMix.fast)}</span>
              </li>
              <li className="flex justify-between">
                <span>Offline / retriever</span>
                <span>{mixPercent(summary.plannerMix.offline)}</span>
              </li>
              <li className="flex justify-between">
                <span>Graph / cache</span>
                <span>{mixPercent(summary.plannerMix.graph)}</span>
              </li>
              <li className="flex justify-between">
                <span>GPT</span>
                <span>{mixPercent(summary.plannerMix.gpt)}</span>
              </li>
            </ul>
            <p className="mt-4 text-xs text-zinc-500">
              Permission blocks:{" "}
              <span className="text-red-400">{summary.blockedPermissionCount}</span>
            </p>
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-300">Top workflows</h3>
            {summary.topWorkflows.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No workflow runs yet</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topWorkflows.map((w) => (
                  <li
                    key={w.name}
                    className="flex justify-between text-sm text-zinc-300"
                  >
                    <span>
                      {w.name}{" "}
                      <span className="text-zinc-500">v{w.version}</span>
                    </span>
                    <span className="text-violet-400">{w.runCount}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-300">Top apps</h3>
            {summary.topApps.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No app launches tracked</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topApps.map((a) => (
                  <li
                    key={a.appId}
                    className="flex justify-between text-sm text-zinc-300"
                  >
                    <span>{a.appId}</span>
                    <span className="text-cyan-400">{a.openCount}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 md:col-span-2">
            <h3 className="text-sm font-medium text-zinc-300">
              Top failed commands
            </h3>
            {summary.topFailedCommands.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No failures recorded</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topFailedCommands.map((row) => (
                  <li
                    key={row.command}
                    className="flex justify-between text-sm text-zinc-300"
                  >
                    <span className="truncate pr-4">"{row.command}"</span>
                    <span className="shrink-0 text-red-400">{row.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-300">
              Top clarifications
            </h3>
            {summary.topClarifications.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No clarifications yet</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topClarifications.map((row) => (
                  <li
                    key={row.command}
                    className="flex justify-between text-sm text-zinc-300"
                  >
                    <span className="truncate pr-4">"{row.command}"</span>
                    <span className="shrink-0 text-amber-400">{row.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-medium text-zinc-300">
              Top search misses
            </h3>
            {summary.topSearchMisses.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No retriever misses</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topSearchMisses.map((row) => (
                  <li
                    key={row.command}
                    className="flex justify-between text-sm text-zinc-300"
                  >
                    <span className="truncate pr-4">"{row.command}"</span>
                    <span className="shrink-0 text-orange-400">{row.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
