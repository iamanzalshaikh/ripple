import { useCallback, useEffect, useState } from "react";
import { BackLink, SecondaryButton } from "../components/theme/ui";

type Summary = NonNullable<
  Awaited<ReturnType<RippleApi["getTelemetrySummary"]>>["summary"]
>;

type P85Dashboard = NonNullable<
  Awaited<ReturnType<RippleApi["getP85Dashboard"]>>["dashboard"]
>;

interface Props {
  onBack: () => void;
}

export function TelemetryPage({ onBack }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ciGate, setCiGate] = useState<{
    passed: number;
    total: number;
    passRatePercent: number;
    thresholdPercent: number;
    meetsGate: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [gateLoading, setGateLoading] = useState(false);
  const [p85Loading, setP85Loading] = useState(true);
  const [p85, setP85] = useState<P85Dashboard | null>(null);
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

  const loadGate = useCallback(async () => {
    setGateLoading(true);
    const res = await window.ripple.getCiGateStatus();
    if (res.ok && res.gate) {
      setCiGate(res.gate);
    }
    setGateLoading(false);
  }, []);

  const loadP85 = useCallback(async () => {
    setP85Loading(true);
    const res = await window.ripple.getP85Dashboard();
    if (res.ok && res.dashboard) {
      setP85(res.dashboard);
    }
    setP85Loading(false);
  }, []);

  useEffect(() => {
    void load();
    void loadGate();
    void loadP85();
  }, [load, loadGate, loadP85]);

  async function handleExportP85() {
    const res = await window.ripple.exportPlannerShadowCsv();
    if (!res.ok || !res.csv) {
      setError(res.message ?? "P8.5 export failed");
      return;
    }
    const blob = new Blob([res.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ripple-p85-shadow-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
          <BackLink onClick={onBack}>Dashboard</BackLink>
          <h2 className="mt-2 text-xl font-semibold text-onboard-ink">
            Observability
          </h2>
          <p className="text-sm text-onboard-subtle">
            P6 telemetry — last {summary?.total ?? 0} events
            {summary?.avgLatencyMs ? ` · avg ${summary.avgLatencyMs}ms` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <SecondaryButton
            onClick={() => {
              void load();
              void loadGate();
              void loadP85();
            }}
            disabled={loading || gateLoading || p85Loading}
            className="px-3 py-1.5"
          >
            Refresh
          </SecondaryButton>
          <SecondaryButton
            onClick={() => void handleExport()}
            className="border-onboard-accent/40 px-3 py-1.5 text-onboard-accent-hover"
          >
            Export CSV
          </SecondaryButton>
        </div>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-red-600">{error}</p>
      ) : null}

      {ciGate ? (
        <section className="mb-6 rounded-2xl border border-onboard-border bg-onboard-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-onboard-ink">CI gate (P6)</h3>
              <p className="mt-1 text-xs text-onboard-subtle">
                Production matrix — threshold {ciGate.thresholdPercent}%
              </p>
            </div>
            <p
              className={`text-2xl font-semibold ${ciGate.meetsGate ? "text-emerald-600" : "text-red-600"}`}
            >
              {ciGate.passRatePercent}%
            </p>
          </div>
          <p className="mt-2 text-sm text-onboard-muted">
            {ciGate.passed}/{ciGate.total} cases pass
            {gateLoading ? " · rechecking…" : ""}
          </p>
        </section>
      ) : gateLoading ? (
        <p className="mb-4 text-sm text-onboard-muted">Running CI gate check…</p>
      ) : null}

      <section className="mb-6 rounded-2xl border border-onboard-accent/30 bg-onboard-accent/5 p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-onboard-accent-hover">
              P8.5 Universal Planner
            </h3>
            <p className="mt-1 text-xs text-onboard-subtle">
              Session + SQLite shadow · router parity for legacy deprecation
            </p>
          </div>
          <div className="flex items-center gap-2">
            {p85?.routerParity.readyForDeprecation ? (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                Ready to deprecate legacy routers
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                Shadow mode — collecting parity data
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleExportP85()}
              className="rounded-lg border border-onboard-accent/40 px-3 py-1.5 text-xs text-onboard-accent-hover transition hover:bg-onboard-accent/10"
            >
              Export P8.5 CSV
            </button>
          </div>
        </div>

        {p85Loading && !p85 ? (
          <p className="text-sm text-onboard-muted">Loading P8.5 metrics…</p>
        ) : p85 ? (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4">
              <p className="text-xs text-onboard-subtle">L0 hit rate (persisted)</p>
              <p className="mt-1 text-2xl font-semibold text-sky-600">
                {p85.persisted.l0HitRatePct}%
              </p>
              <p className="mt-1 text-xs text-onboard-subtle">
                {p85.persisted.l0Hits}/{p85.persisted.execute} executes
              </p>
            </div>
            <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4">
              <p className="text-xs text-onboard-subtle">GPT fallback</p>
              <p className="mt-1 text-2xl font-semibold text-onboard-accent-hover">
                {p85.persisted.gptFallbackPct}%
              </p>
              <p className="mt-1 text-xs text-onboard-subtle">
                cache entries: {p85.cacheEntries}
              </p>
            </div>
            <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4">
              <p className="text-xs text-onboard-subtle">Router mismatches</p>
              <p className="mt-1 text-2xl font-semibold text-amber-600">
                {p85.routerParity.mismatchTotal}
              </p>
              <p className="mt-1 text-xs text-onboard-subtle">
                {p85.routerParity.p85Executes} P8.5 executes this session
              </p>
            </div>

            <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4 md:col-span-2">
              <p className="text-xs font-medium text-onboard-muted">Session planner mix</p>
              <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-onboard-ink">
                <li className="flex justify-between">
                  <span>Total</span>
                  <span>{p85.session.total}</span>
                </li>
                <li className="flex justify-between">
                  <span>Execute</span>
                  <span className="text-emerald-600">{p85.session.execute}</span>
                </li>
                <li className="flex justify-between">
                  <span>Defer</span>
                  <span>{p85.session.defer}</span>
                </li>
                <li className="flex justify-between">
                  <span>Clarify</span>
                  <span className="text-amber-600">{p85.session.clarify}</span>
                </li>
                <li className="flex justify-between">
                  <span>Avg latency</span>
                  <span>{p85.session.avgLatencyMs}ms</span>
                </li>
                <li className="flex justify-between">
                  <span>Fallback %</span>
                  <span>{p85.session.fallbackPct}%</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4">
              <p className="text-xs font-medium text-onboard-muted">Top tools</p>
              {p85.persisted.topTools.length === 0 ? (
                <p className="mt-2 text-xs text-onboard-subtle">No executes yet</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs text-onboard-ink">
                  {p85.persisted.topTools.slice(0, 6).map((t) => (
                    <li key={t.tool} className="flex justify-between">
                      <span className="truncate pr-2">{t.tool}</span>
                      <span className="text-onboard-accent-hover">{t.count}×</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {p85.persisted.topDeferReasons.length > 0 ? (
              <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4 md:col-span-3">
                <p className="text-xs font-medium text-onboard-muted">Top defer reasons</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {p85.persisted.topDeferReasons.map((r) => (
                    <li
                      key={r.reason}
                      className="rounded-lg border border-onboard-border px-2 py-1 text-xs text-onboard-ink"
                    >
                      {r.reason}{" "}
                      <span className="text-orange-600">{r.count}×</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {p85.routerParity.recentMismatches.length > 0 ? (
              <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4 md:col-span-3">
                <p className="text-xs font-medium text-onboard-muted">
                  Recent legacy router mismatches
                </p>
                <ul className="mt-2 space-y-2">
                  {p85.routerParity.recentMismatches.map((m, i) => (
                    <li
                      key={`${m.at}-${i}`}
                      className="rounded-lg border border-onboard-border px-3 py-2 text-xs"
                    >
                      <p className="truncate text-onboard-ink">"{m.command}"</p>
                      <p className="mt-1 text-onboard-subtle">
                        {m.legacyRouter} · P8.5 would {m.p85Reason}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {p85.recentObservations && p85.recentObservations.length > 0 ? (
              <div className="rounded-xl border border-onboard-border bg-onboard-surface p-4 md:col-span-3">
                <p className="text-xs font-medium text-onboard-muted">
                  P9 execution observations (session)
                </p>
                <ul className="mt-2 space-y-2">
                  {p85.recentObservations.map((o, i) => (
                    <li
                      key={`${o.at}-${i}`}
                      className="flex items-start justify-between gap-3 rounded-lg border border-onboard-border px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-onboard-ink">"{o.command}"</p>
                        <p className="mt-1 text-onboard-subtle">
                          {o.planSource} · {o.tools.join(", ")}
                          {o.recovered ? " · recovered" : ""}
                        </p>
                      </div>
                      <span
                        className={
                          o.succeeded ? "text-emerald-600" : "text-red-600"
                        }
                      >
                        {o.succeeded ? "ok" : "fail"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-onboard-muted">P8.5 metrics unavailable</p>
        )}
      </section>

      {loading && !summary ? (
        <p className="text-sm text-onboard-muted">Loading…</p>
      ) : summary ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5">
            <h3 className="text-sm font-medium text-onboard-ink">Success rate</h3>
            <p className="mt-2 text-3xl font-semibold text-emerald-600">
              {summary.successRatePercent}%
            </p>
            <p className="mt-1 text-xs text-onboard-subtle">
              7-day rolling: {summary.rolling7DaySuccessRate}%
            </p>
            <ul className="mt-4 space-y-1 text-xs text-onboard-muted">
              {Object.entries(summary.byOutcome).map(([k, v]) => (
                <li key={k} className="flex justify-between">
                  <span>{k}</span>
                  <span className="text-onboard-ink">{v}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5">
            <h3 className="text-sm font-medium text-onboard-ink">Planner mix</h3>
            <ul className="mt-3 space-y-2 text-sm text-onboard-ink">
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
            <p className="mt-4 text-xs text-onboard-subtle">
              Permission blocks:{" "}
              <span className="text-red-600">{summary.blockedPermissionCount}</span>
            </p>
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5">
            <h3 className="text-sm font-medium text-onboard-ink">Top workflows</h3>
            {summary.topWorkflows.length === 0 ? (
              <p className="mt-2 text-sm text-onboard-muted">No workflow runs yet</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topWorkflows.map((w) => (
                  <li
                    key={w.name}
                    className="flex justify-between text-sm text-onboard-ink"
                  >
                    <span>
                      {w.name}{" "}
                      <span className="text-onboard-subtle">v{w.version}</span>
                    </span>
                    <span className="text-onboard-accent-hover">{w.runCount}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5">
            <h3 className="text-sm font-medium text-onboard-ink">Top apps</h3>
            {summary.topApps.length === 0 ? (
              <p className="mt-2 text-sm text-onboard-muted">No app launches tracked</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topApps.map((a) => (
                  <li
                    key={a.appId}
                    className="flex justify-between text-sm text-onboard-ink"
                  >
                    <span>{a.appId}</span>
                    <span className="text-sky-600">{a.openCount}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5 md:col-span-2">
            <h3 className="text-sm font-medium text-onboard-ink">Recent failures</h3>
            {summary.recentFailures.length === 0 ? (
              <p className="mt-2 text-sm text-onboard-muted">No recent failures</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.recentFailures.map((row, i) => (
                  <li
                    key={`${row.command}-${row.at}-${i}`}
                    className="rounded-lg border border-onboard-border px-3 py-2 text-sm"
                  >
                    <p className="truncate text-onboard-ink">"{row.command}"</p>
                    <p className="mt-1 text-xs text-onboard-subtle">
                      {row.outcome ?? "unknown"}
                      {row.planner_source ? ` · ${row.planner_source}` : ""}
                      {row.detail ? ` · ${row.detail}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5 md:col-span-2">
            <h3 className="text-sm font-medium text-onboard-ink">
              Top failed commands
            </h3>
            {summary.topFailedCommands.length === 0 ? (
              <p className="mt-2 text-sm text-onboard-muted">No failures recorded</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topFailedCommands.map((row) => (
                  <li
                    key={row.command}
                    className="flex justify-between text-sm text-onboard-ink"
                  >
                    <span className="truncate pr-4">"{row.command}"</span>
                    <span className="shrink-0 text-red-600">{row.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5">
            <h3 className="text-sm font-medium text-onboard-ink">
              Top clarifications
            </h3>
            {summary.topClarifications.length === 0 ? (
              <p className="mt-2 text-sm text-onboard-muted">No clarifications yet</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topClarifications.map((row) => (
                  <li
                    key={row.command}
                    className="flex justify-between text-sm text-onboard-ink"
                  >
                    <span className="truncate pr-4">"{row.command}"</span>
                    <span className="shrink-0 text-amber-600">{row.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-onboard-border bg-onboard-card p-5">
            <h3 className="text-sm font-medium text-onboard-ink">
              Top search misses
            </h3>
            {summary.topSearchMisses.length === 0 ? (
              <p className="mt-2 text-sm text-onboard-muted">No retriever misses</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {summary.topSearchMisses.map((row) => (
                  <li
                    key={row.command}
                    className="flex justify-between text-sm text-onboard-ink"
                  >
                    <span className="truncate pr-4">"{row.command}"</span>
                    <span className="shrink-0 text-orange-600">{row.count}×</span>
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
