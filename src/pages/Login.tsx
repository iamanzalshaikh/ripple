import { FormEvent, useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { useAuthStore } from "../store/authStore";

type AuthMode = "login" | "signup";

type HealthState =
  | { status: "checking" }
  | { status: "ok"; message: string; url: string; latencyMs?: number }
  | { status: "error"; message: string; url: string };

export function LoginPage() {
  const { login, signup, loading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [health, setHealth] = useState<HealthState>({ status: "checking" });

  async function runHealthCheck() {
    setHealth({ status: "checking" });
    try {
      const res = await getRippleApi().checkApiHealth();
      if (res.ok) {
        setHealth({
          status: "ok",
          message: res.message,
          url: res.url,
          latencyMs: res.latencyMs,
        });
      } else {
        setHealth({ status: "error", message: res.message, url: res.url });
      }
    } catch (e: unknown) {
      setHealth({
        status: "error",
        message: e instanceof Error ? e.message : "Health check failed",
        url: "—",
      });
    }
  }

  useEffect(() => {
    void runHealthCheck();
  }, []);

  function switchMode(next: AuthMode) {
    setMode(next);
    clearError();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === "login") {
      await login(email.trim(), password);
    } else {
      await signup(email.trim(), password, name.trim() || undefined);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl shadow-black/40">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Ripple
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          {mode === "login"
            ? "Desktop AI assistant — sign in to continue"
            : "Create your Ripple account"}
        </p>

        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  health.status === "checking"
                    ? "animate-pulse bg-amber-400"
                    : health.status === "ok"
                      ? "bg-emerald-400"
                      : "bg-red-400"
                }`}
              />
              <span className="truncate text-zinc-400">
                {health.status === "checking"
                  ? "Checking API…"
                  : health.message}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void runHealthCheck()}
              className="shrink-0 text-violet-400 hover:text-violet-300"
            >
              Retry
            </button>
          </div>
          {health.status !== "checking" ? (
            <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">
              {health.url}
              {health.status === "ok" && health.latencyMs != null
                ? ` · ${health.latencyMs}ms`
                : null}
            </p>
          ) : null}
        </div>

        <div
          className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-zinc-800 bg-zinc-950 p-1"
          role="tablist"
        >
          {(["login", "signup"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={mode === tab}
              onClick={() => switchMode(tab)}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                mode === tab
                  ? "bg-zinc-800 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {tab === "login" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          {mode === "signup" ? (
            <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
              Name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none ring-violet-500/0 transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/30"
            />
          </label>
          {mode === "signup" ? (
            <p className="-mt-1 text-xs text-zinc-500">
              Password: 8+ chars, uppercase, lowercase, and a number.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
