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
          ? "Executed — check actions below or desktop."
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
              disabled={commandBusy || !textCommand.trim()}
              onClick={() => void runTextCommand()}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              {commandBusy ? "…" : "Run"}
            </button>
          </div>
          {commandResult ? (
            <p
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
