import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useSocketStore } from "../store/socketStore";
import { getRippleApi } from "../lib/rippleApi";
import { HistoryPage } from "./History";
import { TelemetryPage } from "./Telemetry";

interface Props {
  user: RippleUser;
  sessionId: string | null;
}

function statusLabel(status: string, connected: boolean): string {
  if (connected) return "Connected";
  if (status === "reconnecting") return "Reconnecting…";
  if (status === "connecting") return "Connecting…";
  return "Disconnected";
}

function statusColor(status: string, connected: boolean): string {
  if (connected) return "bg-emerald-500";
  if (status === "reconnecting" || status === "connecting")
    return "bg-amber-400";
  return "bg-zinc-500";
}

function summarizeCommandResult(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "Executed — check actions below or desktop.";
  }
  const payload = data as {
    execution?: {
      records?: Array<{ detail?: string; error?: string; status?: string }>;
      allSucceeded?: boolean;
    };
    intent?: string;
  };
  const records = payload.execution?.records ?? [];
  const details = records
    .map((r) => (r.status === "failed" ? r.error : r.detail))
    .filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  if (details.length > 0) {
    const joined = details.join("\n").trim();
    return joined.length > 600 ? `${joined.slice(0, 600)}…` : joined;
  }
  return "Executed — check actions below or desktop.";
}

function DebugRow({
  label,
  value,
  tone,
  multiline,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "err";
  multiline?: boolean;
}) {
  const color =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "warn"
        ? "text-amber-300"
        : tone === "err"
          ? "text-red-300"
          : "text-zinc-200";
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <span className="text-zinc-500">{label}</span>
      <span
        className={`${color} ${multiline ? "max-h-48 overflow-y-auto whitespace-pre-wrap break-words" : "truncate"}`}
      >
        {value}
      </span>
    </div>
  );
}

export function HomePage({ user, sessionId }: Props) {
  const [view, setView] = useState<"dashboard" | "history" | "telemetry">(
    "dashboard",
  );
  const [textCommand, setTextCommand] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandResult, setCommandResult] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<{
    ready: boolean;
    checks: Array<{ id: string; ok: boolean; detail: string }>;
  } | null>(null);
  const { logout } = useAuthStore();
  const {
    status,
    connected,
    lastTranscript,
    lastCommandPreview,
    lastExecution,
    lastGeneratedText,
    lastError,
    lastDebug,
    debugLog,
    hydrate,
    bindEvents,
  } = useSocketStore();

  useEffect(() => {
    if (view !== "dashboard") return;
    void hydrate();
    void getRippleApi()
      .runPreflightHealth()
      .then((r) => setPreflight({ ready: r.ready, checks: r.checks }))
      .catch(() => undefined);
    return bindEvents();
  }, [view, hydrate, bindEvents]);

  async function runTextCommand() {
    const cmd = textCommand.trim();
    if (!cmd || commandBusy) return;
    setCommandBusy(true);
    setCommandResult(null);
    try {
      const res = await getRippleApi().executeCommand({
        command: cmd,
        sessionId: sessionId ?? undefined,
      });
      setCommandResult(
        res.ok
          ? summarizeCommandResult(res.data)
          : (res.message ?? "Command failed"),
      );
    } catch (e: unknown) {
      setCommandResult(e instanceof Error ? e.message : "Command failed");
    } finally {
      setCommandBusy(false);
    }
  }

  if (view === "history") {
    return (
      <div className="min-h-full bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 px-8 py-4">
          <p className="text-sm text-zinc-400">Signed in as {user.email}</p>
        </header>
        <HistoryPage onBack={() => setView("dashboard")} />
      </div>
    );
  }

  if (view === "telemetry") {
    return (
      <div className="min-h-full bg-zinc-950 text-zinc-100">
        <header className="border-b border-zinc-800 px-8 py-4">
          <p className="text-sm text-zinc-400">Signed in as {user.email}</p>
        </header>
        <TelemetryPage onBack={() => setView("dashboard")} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <header className="flex items-start justify-between border-b border-zinc-800 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Ripple</h1>
          <p className="mt-1 text-sm text-zinc-400">Signed in as {user.email}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setView("telemetry")}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-violet-500 hover:text-white"
          >
            Telemetry
          </button>
          <button
            type="button"
            onClick={() => setView("history")}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-violet-500 hover:text-white"
          >
            History
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-900"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-4xl gap-6 p-8 md:grid-cols-2">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${statusColor(status, connected)}`}
            />
            <h2 className="text-lg font-medium">Demo readiness</h2>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Socket:{" "}
            <span className="text-zinc-200">
              {statusLabel(status, connected)}
            </span>
            {preflight ? (
              <span
                className={`ml-2 ${preflight.ready ? "text-emerald-400" : "text-amber-400"}`}
              >
                · {preflight.ready ? "Ready for demo" : "Fix items below"}
              </span>
            ) : null}
          </p>
          {preflight?.checks.length ? (
            <ul className="mt-3 space-y-1 text-xs text-zinc-400">
              {preflight.checks.map((c) => (
                <li key={c.id} className={c.ok ? "text-zinc-400" : "text-amber-400"}>
                  {c.ok ? "✓" : "○"} {c.detail}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-4 space-y-2 text-sm text-zinc-300">
            <li>
              <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs">
                Ctrl
              </kbd>{" "}
              +{" "}
              <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-xs">
                Space
              </kbd>{" "}
              — voice command
            </li>
            <li>Or type a command below (backup if mic fails)</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-violet-300">
            Type command
          </h3>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              data-testid="ripple-command-input"
              value={textCommand}
              onChange={(e) => setTextCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runTextCommand();
              }}
              placeholder='e.g. "Download kholo" or "Open my resume"'
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              data-testid="ripple-command-run"
              disabled={commandBusy || !textCommand.trim()}
              onClick={() => void runTextCommand()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {commandBusy ? "…" : "Run"}
            </button>
          </div>
          {commandResult ? (
            <p
              data-testid="ripple-command-result"
              className={`mt-3 text-xs ${commandResult.startsWith("Executed") ? "text-emerald-400" : "text-amber-300"}`}
            >
              {commandResult}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-violet-500/20 bg-violet-950/20 p-6 md:col-span-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-violet-300">
            Last voice command
          </h3>
          {lastTranscript ? (
            <p className="mt-3 text-sm leading-relaxed text-zinc-200">
              “{lastTranscript}”
            </p>
          ) : (
            <p className="mt-3 text-sm text-zinc-500">No transcript yet</p>
          )}
          {lastGeneratedText ? (
            <p className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-zinc-900/80 p-3 text-xs leading-relaxed text-zinc-300">
              {lastGeneratedText}
            </p>
          ) : lastCommandPreview ? (
            <p className="mt-3 text-xs text-emerald-400/90">
              {lastCommandPreview}
            </p>
          ) : null}
          {lastError ? (
            <p className="mt-3 text-xs text-red-400">{lastError}</p>
          ) : null}
        </section>

        <section
          data-testid="ripple-debug-console"
          className="md:col-span-2 rounded-2xl border border-cyan-500/30 bg-cyan-950/15 p-6"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-cyan-300">
              Ripple Debug Console
            </h3>
            <p className="text-[11px] text-zinc-500">
              transcript · intent · tool · response
            </p>
          </div>

          {lastDebug ? (
            <div className="mt-4 space-y-3 font-mono text-xs leading-relaxed">
              <DebugRow label="Command" value={lastDebug.command} />
              <DebugRow
                label="Transcript"
                value={lastDebug.transcript ?? lastTranscript ?? "—"}
              />
              <DebugRow
                label="Intent"
                value={lastDebug.intent ?? "—"}
              />
              <DebugRow
                label="Tool"
                value={
                  lastDebug.tools?.length
                    ? lastDebug.tools.join(", ")
                    : (lastDebug.tool ?? "—")
                }
              />
              <DebugRow
                label="Status"
                value={lastDebug.status}
                tone={
                  lastDebug.status === "SUCCESS"
                    ? "ok"
                    : lastDebug.status === "CLARIFY"
                      ? "warn"
                      : "err"
                }
              />
              <DebugRow
                label="Result"
                value={lastDebug.result ?? "—"}
                multiline
              />
              {lastDebug.error ? (
                <DebugRow label="Error" value={lastDebug.error} tone="err" multiline />
              ) : null}
              {lastDebug.source ? (
                <DebugRow label="Source" value={lastDebug.source} />
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-zinc-500">
              Run a voice or typed command — debug output appears here.
            </p>
          )}

          {debugLog.length > 1 ? (
            <div className="mt-5 border-t border-cyan-900/50 pt-4">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-zinc-500">
                Recent
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-zinc-400">
                {debugLog.slice(1).map((d, i) => (
                  <li key={`${d.at}-${i}`} className="truncate">
                    <span
                      className={
                        d.status === "SUCCESS"
                          ? "text-emerald-400"
                          : d.status === "CLARIFY"
                            ? "text-amber-300"
                            : "text-red-400"
                      }
                    >
                      {d.status}
                    </span>{" "}
                    · {d.tool ?? d.intent ?? "—"} · {d.command}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        {lastExecution?.length ? (
          <section className="md:col-span-2 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-6">
            <h3 className="text-sm font-medium text-emerald-300">
              Last actions executed
            </h3>
            <ul className="mt-3 space-y-2">
              {lastExecution.map((r) => (
                <li
                  key={r.index}
                  className="flex items-start gap-2 text-sm text-zinc-300"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      r.status === "executed" ? "bg-emerald-400" : "bg-red-400"
                    }`}
                  />
                  <span>
                    <span className="font-mono text-xs text-violet-300">
                      {r.type}
                    </span>
                    {" — "}
                    {r.status === "executed"
                      ? (r.detail ?? "OK")
                      : (r.error ?? "Failed")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
