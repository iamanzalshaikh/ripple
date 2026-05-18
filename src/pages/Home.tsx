import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useSocketStore } from "../store/socketStore";
import { HistoryPage } from "./History";

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
  const [view, setView] = useState<"dashboard" | "history">("dashboard");
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
    return bindEvents();
  }, [view, hydrate, bindEvents]);

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
            <h2 className="text-lg font-medium">Week 4 — MVP</h2>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Socket:{" "}
            <span className="text-zinc-200">
              {statusLabel(status, connected)}
            </span>
            {!connected ? (
              <span className="block text-xs text-amber-400/90">
                Commands use REST fallback when socket is offline
              </span>
            ) : null}
          </p>
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
            <li>Session ends on quit / logout</li>
            <li className="text-zinc-500">
              Session:{" "}
              <span className="font-mono text-xs text-zinc-400">
                {sessionId ?? "—"}
              </span>
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-violet-500/20 bg-violet-950/20 p-6">
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
