import { useEffect, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { useSocketStore } from "../store/socketStore";
import { getRippleApi } from "../lib/rippleApi";
import { HistoryPage } from "./History";
import { TelemetryPage } from "./Telemetry";
import { DictionaryPage } from "./Dictionary";
import { SnippetsPage } from "./Snippets";
import { StylesPage } from "./Styles";
import { LanguagePage } from "./Language";
import { NotesPage } from "./Notes";
import { LogOutIcon } from "../components/theme/icons";
import { AppShell, Card, NavPill, StatusDot } from "../components/theme/ui";

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

function statusTone(status: string, connected: boolean): "ok" | "warn" | "neutral" {
  if (connected) return "ok";
  if (status === "reconnecting" || status === "connecting") return "warn";
  return "neutral";
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
      ? "text-emerald-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "err"
          ? "text-red-600"
          : "text-onboard-ink";
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <span className="text-onboard-subtle">{label}</span>
      <span
        className={`${color} ${multiline ? "max-h-48 overflow-y-auto whitespace-pre-wrap break-words" : "truncate"}`}
      >
        {value}
      </span>
    </div>
  );
}

function isDebugUi(): boolean {
  try {
    return window.localStorage.getItem("ripple:debug") === "1";
  } catch {
    return false;
  }
}

export function HomePage({ user, sessionId }: Props) {
  const [view, setView] = useState<
    | "dashboard"
    | "history"
    | "telemetry"
    | "dictionary"
    | "snippets"
    | "styles"
    | "language"
    | "notes"
  >("dashboard");
  const [quickCaptureNoteId, setQuickCaptureNoteId] = useState<string | null>(null);
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

  // P10.3 lite — Quick capture hotkey brings this window forward and asks
  // it to jump straight into a freshly created note.
  useEffect(() => {
    return getRippleApi().onIpcEvent?.("notes:quickCapture", (payload) => {
      const noteId =
        payload && typeof payload === "object" && "noteId" in payload
          ? (payload as { noteId?: unknown }).noteId
          : undefined;
      if (typeof noteId === "string") {
        setQuickCaptureNoteId(noteId);
        setView("notes");
      }
    });
  }, []);

  const debugUi = isDebugUi();

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
      <AppShell>
        <div className="border-b border-onboard-border-soft px-8 py-4">
          <p className="text-sm text-onboard-muted">Signed in as {user.email}</p>
        </div>
        <HistoryPage onBack={() => setView("dashboard")} />
      </AppShell>
    );
  }

  if (view === "telemetry") {
    return (
      <AppShell>
        <div className="border-b border-onboard-border-soft px-8 py-4">
          <p className="text-sm text-onboard-muted">Signed in as {user.email}</p>
        </div>
        <TelemetryPage onBack={() => setView("dashboard")} />
      </AppShell>
    );
  }

  if (view === "dictionary") {
    return <DictionaryPage onBack={() => setView("dashboard")} />;
  }

  if (view === "snippets") {
    return <SnippetsPage onBack={() => setView("dashboard")} />;
  }

  if (view === "styles") {
    return <StylesPage onBack={() => setView("dashboard")} />;
  }

  if (view === "language") {
    return <LanguagePage onBack={() => setView("dashboard")} />;
  }

  if (view === "notes") {
    return (
      <NotesPage
        onBack={() => setView("dashboard")}
        initialNoteId={quickCaptureNoteId}
        onInitialNoteConsumed={() => setQuickCaptureNoteId(null)}
      />
    );
  }

  return (
    <AppShell>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-onboard-border-soft px-8 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-onboard-ink">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-onboard-muted">
            Voice typing for Windows · {user.email}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NavPill onClick={() => setView("notes")}>Notes</NavPill>
          <NavPill onClick={() => setView("language")}>Language</NavPill>
          <NavPill onClick={() => setView("styles")}>Styles</NavPill>
          <NavPill onClick={() => setView("snippets")}>Snippets</NavPill>
          <NavPill onClick={() => setView("dictionary")}>Dictionary</NavPill>
          {debugUi ? (
            <NavPill onClick={() => setView("telemetry")}>Telemetry</NavPill>
          ) : null}
          <NavPill onClick={() => setView("history")}>History</NavPill>
          <NavPill onClick={() => void logout()} className="gap-1.5">
            <LogOutIcon width={14} height={14} />
            Log out
          </NavPill>
        </div>
      </header>

      <div className="mx-auto grid max-w-4xl gap-6 p-8 md:grid-cols-2">
        <Card className="bg-onboard-card-soft p-6">
          <div className="flex items-center gap-2">
            <StatusDot tone={statusTone(status, connected)} />
            <h2 className="text-lg font-medium text-onboard-ink">
              Demo readiness
            </h2>
          </div>
          <p className="mt-2 text-sm text-onboard-muted">
            Socket:{" "}
            <span className="text-onboard-ink">
              {statusLabel(status, connected)}
            </span>
            {preflight ? (
              <span
                className={`ml-2 ${preflight.ready ? "text-emerald-600" : "text-amber-600"}`}
              >
                · {preflight.ready ? "Ready for demo" : "Fix items below"}
              </span>
            ) : null}
          </p>
          {preflight?.checks.length ? (
            <ul className="mt-3 space-y-1 text-xs text-onboard-muted">
              {preflight.checks.map((c) => (
                <li key={c.id} className={c.ok ? "text-onboard-muted" : "text-amber-600"}>
                  {c.ok ? "✓" : "○"} {c.detail}
                </li>
              ))}
            </ul>
          ) : null}
          <ul className="mt-4 space-y-2 text-sm text-onboard-ink">
            <li>
              <kbd className="rounded border border-onboard-border bg-onboard-surface px-1.5 py-0.5 text-xs">
                Shift
              </kbd>{" "}
              +{" "}
              <kbd className="rounded border border-onboard-border bg-onboard-surface px-1.5 py-0.5 text-xs">
                Space
              </kbd>{" "}
              — dictate
            </li>
            <li>Or type a command below (backup if mic fails)</li>
          </ul>
        </Card>

        <Card className="border-onboard-accent/30 bg-onboard-accent/5 p-6">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-accent-hover">
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
              className="min-w-0 flex-1 rounded-lg border border-onboard-border bg-onboard-surface px-3 py-2 text-sm text-onboard-ink placeholder:text-onboard-subtle outline-none focus:border-onboard-accent"
            />
            <button
              type="button"
              data-testid="ripple-command-run"
              disabled={commandBusy || !textCommand.trim()}
              onClick={() => void runTextCommand()}
              className="rounded-lg bg-onboard-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-onboard-accent-hover disabled:opacity-50"
            >
              {commandBusy ? "…" : "Run"}
            </button>
          </div>
          {commandResult ? (
            <p
              data-testid="ripple-command-result"
              className={`mt-3 text-xs ${commandResult.startsWith("Executed") ? "text-emerald-600" : "text-amber-600"}`}
            >
              {commandResult}
            </p>
          ) : null}
        </Card>

        <Card className="border-onboard-accent/20 bg-onboard-accent/5 p-6 md:col-span-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-accent-hover">
            Last voice command
          </h3>
          {lastTranscript ? (
            <p className="mt-3 text-sm leading-relaxed text-onboard-ink">
              “{lastTranscript}”
            </p>
          ) : (
            <p className="mt-3 text-sm text-onboard-subtle">No transcript yet</p>
          )}
          {lastGeneratedText ? (
            <p className="mt-3 max-h-32 overflow-y-auto rounded-lg bg-onboard-surface p-3 text-xs leading-relaxed text-onboard-ink">
              {lastGeneratedText}
            </p>
          ) : lastCommandPreview ? (
            <p className="mt-3 text-xs text-emerald-600">
              {lastCommandPreview}
            </p>
          ) : null}
          {lastError ? (
            <p className="mt-3 text-xs text-red-600">{lastError}</p>
          ) : null}
        </Card>

        <Card
          data-testid="ripple-debug-console"
          className="border-sky-500/30 bg-sky-500/5 p-6 md:col-span-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium uppercase tracking-wide text-sky-700">
              Ripple Debug Console
            </h3>
            <p className="text-[11px] text-onboard-subtle">
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
            <p className="mt-4 text-sm text-onboard-subtle">
              Run a voice or typed command — debug output appears here.
            </p>
          )}

          {debugLog.length > 1 ? (
            <div className="mt-5 border-t border-onboard-border-soft pt-4">
              <p className="mb-2 text-[11px] uppercase tracking-wide text-onboard-subtle">
                Recent
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-onboard-muted">
                {debugLog.slice(1).map((d, i) => (
                  <li key={`${d.at}-${i}`} className="truncate">
                    <span
                      className={
                        d.status === "SUCCESS"
                          ? "text-emerald-600"
                          : d.status === "CLARIFY"
                            ? "text-amber-600"
                            : "text-red-600"
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
        </Card>

        {lastExecution?.length ? (
          <Card className="border-emerald-500/20 bg-emerald-500/5 p-6 md:col-span-2">
            <h3 className="text-sm font-medium text-emerald-700">
              Last actions executed
            </h3>
            <ul className="mt-3 space-y-2">
              {lastExecution.map((r) => (
                <li
                  key={r.index}
                  className="flex items-start gap-2 text-sm text-onboard-ink"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      r.status === "executed" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <span>
                    <span className="font-mono text-xs text-onboard-accent-hover">
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
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
