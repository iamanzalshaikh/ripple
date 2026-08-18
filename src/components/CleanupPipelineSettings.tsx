import { useEffect, useState } from "react";
import { ToggleSwitch } from "./theme/ui";
import { getRippleApi } from "../lib/rippleApi";

type Layers = {
  transcribe: true;
  cleanup: boolean;
  format: boolean;
  context: boolean;
};

type Level = "none" | "light" | "medium" | "high" | "custom";

const LEVELS: Array<{
  id: Exclude<Level, "custom">;
  label: string;
  detail: string;
}> = [
  { id: "none", label: "None", detail: "Raw transcript. No cleanup." },
  { id: "light", label: "Light", detail: "Fillers and stutters only." },
  { id: "medium", label: "Medium", detail: "Fillers + punctuation." },
  { id: "high", label: "High", detail: "Full rewrite + per-app tone." },
];

const DEFAULT_LAYERS: Layers = {
  transcribe: true,
  cleanup: true,
  format: true,
  context: true,
};

export function CleanupPipelineSettings() {
  const [level, setLevel] = useState<Level>("high");
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await getRippleApi().pipeline.get();
      if (!res.ok || !res.layers) {
        setError(res.message ?? "Failed to load cleanup settings");
        return;
      }
      setLayers(res.layers);
      setLevel((res.level as Level) || "high");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save(next: { level?: string } & Partial<Layers>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await getRippleApi().pipeline.set(next);
      if (!res.ok || !res.layers) {
        setError(res.message ?? "Failed to save cleanup settings");
        return;
      }
      setLayers(res.layers);
      setLevel((res.level as Level) || "high");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
        Dictation cleanup
      </h3>
      <p className="mt-1 text-xs text-onboard-muted">
        Four stages: transcribe (always on), cleanup, format, and context.
        Levels are presets; you can also toggle stages on their own.
      </p>
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      {loading ? (
        <p className="mt-4 text-sm text-onboard-muted">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {LEVELS.map((item) => {
              const active = level === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void save({ level: item.id })}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                    active
                      ? "border-onboard-accent bg-onboard-accent/10 text-onboard-ink"
                      : "border-onboard-border bg-onboard-surface text-onboard-ink hover:border-onboard-accent/40"
                  }`}
                >
                  <span className="font-medium">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-onboard-muted">
                    {item.detail}
                  </span>
                </button>
              );
            })}
          </div>
          {level === "custom" ? (
            <p className="mt-2 text-xs text-onboard-accent-hover">
              Custom mix of stages (not a named preset).
            </p>
          ) : null}

          <div className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-onboard-ink">Transcribe</p>
                <p className="text-xs text-onboard-muted">
                  Whisper speech-to-text. Always on.
                </p>
              </div>
              <ToggleSwitch
                checked
                label="Transcribe"
                disabled
                onChange={() => undefined}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-onboard-ink">Cleanup</p>
                <p className="text-xs text-onboard-muted">
                  Strip um/uh, stutters, and spoken self-corrections.
                </p>
              </div>
              <ToggleSwitch
                checked={layers.cleanup}
                label="Cleanup"
                disabled={busy}
                onChange={() =>
                  void save({
                    cleanup: !layers.cleanup,
                    format: layers.format,
                    context: layers.context,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-onboard-ink">Format</p>
                <p className="text-xs text-onboard-muted">
                  Punctuation, capitalization, and spoken lists.
                </p>
              </div>
              <ToggleSwitch
                checked={layers.format}
                label="Format"
                disabled={busy}
                onChange={() =>
                  void save({
                    cleanup: layers.cleanup,
                    format: !layers.format,
                    context: layers.context,
                  })
                }
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-onboard-ink">Context</p>
                <p className="text-xs text-onboard-muted">
                  On-screen name spelling and per-app tone (Styles).
                </p>
              </div>
              <ToggleSwitch
                checked={layers.context}
                label="Context"
                disabled={busy}
                onChange={() =>
                  void save({
                    cleanup: layers.cleanup,
                    format: layers.format,
                    context: !layers.context,
                  })
                }
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
