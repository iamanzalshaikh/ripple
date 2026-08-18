import { FormEvent, useEffect, useState } from "react";
import { getRippleApi } from "../lib/rippleApi";
import { useAuthStore } from "../store/authStore";
import { LogoMarkIcon, MailIcon, PersonIcon } from "../components/theme/icons";
import { Card, Field, PrimaryButton, TextInput } from "../components/theme/ui";

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
    let cancelled = false;
    const delays = [250, 500, 1000, 2000, 2000, 2000, 2000, 2000];

    async function runHealthCheckWithBackoff() {
      setHealth({ status: "checking" });
      for (let i = 0; i < delays.length; i++) {
        try {
          const res = await getRippleApi().checkApiHealth();
          if (cancelled) return;
          if (res.ok) {
            setHealth({
              status: "ok",
              message: res.message,
              url: res.url,
              latencyMs: res.latencyMs,
            });
            return;
          }
          setHealth({ status: "error", message: res.message, url: res.url });
        } catch (e: unknown) {
          if (cancelled) return;
          setHealth({
            status: "error",
            message: e instanceof Error ? e.message : "Health check failed",
            url: "—",
          });
        }
        if (i < delays.length - 1) {
          await new Promise((r) => setTimeout(r, delays[i]));
        }
      }
    }

    void runHealthCheckWithBackoff();
    return () => {
      cancelled = true;
    };
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
    <div className="flex min-h-full items-center justify-center bg-onboard-bg p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-onboard-ink">
          <LogoMarkIcon />
          <span
            className="text-2xl italic"
            style={{ fontFamily: "var(--font-onboard-serif)" }}
          >
            Ripple
          </span>
        </div>

        <Card>
          <p className="text-center text-sm text-onboard-muted">
            {mode === "login"
              ? "Voice typing for Windows — sign in to continue"
              : "Create your Ripple account"}
          </p>

          <div className="mt-4 rounded-xl border border-onboard-border bg-onboard-surface px-3 py-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    health.status === "checking"
                      ? "animate-pulse bg-amber-500"
                      : health.status === "ok"
                        ? "bg-onboard-success"
                        : "bg-red-500"
                  }`}
                />
                <span className="truncate text-onboard-muted">
                  {health.status === "checking"
                    ? "Connecting…"
                    : health.status === "ok"
                      ? "Ready to sign in"
                      : "Can't reach Ripple. Check your connection."}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void runHealthCheck()}
                className="shrink-0 text-onboard-accent-hover hover:underline"
              >
                Retry
              </button>
            </div>
            {import.meta.env.DEV && health.status !== "checking" ? (
              <p className="mt-1 truncate font-mono text-[10px] text-onboard-subtle">
                {health.url}
                {health.status === "ok" && health.latencyMs != null
                  ? ` · ${health.latencyMs}ms`
                  : null}
              </p>
            ) : null}
          </div>

          <div
            className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-onboard-border bg-onboard-surface p-1"
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
                    ? "bg-onboard-accent text-white shadow-sm"
                    : "text-onboard-muted hover:text-onboard-ink"
                }`}
              >
                {tab === "login" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            {mode === "signup" ? (
              <Field label="Name">
                <TextInput
                  icon={<PersonIcon />}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </Field>
            ) : null}
            <Field label="Email">
              <TextInput
                icon={<MailIcon />}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                autoFocus
              />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
              />
            </Field>
            {mode === "signup" ? (
              <p className="-mt-1 text-xs text-onboard-subtle">
                Password: 8+ chars, uppercase, lowercase, and a number.
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-red-500" role="alert">
                {error}
              </p>
            ) : null}
            <PrimaryButton
              type="submit"
              disabled={loading}
              className="mt-1 w-full py-3"
            >
              {loading
                ? mode === "login"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </PrimaryButton>
          </form>
        </Card>
      </div>
    </div>
  );
}
