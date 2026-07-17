import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceCapture } from "../hooks/useVoiceCapture";
import { getRippleApi } from "../lib/rippleApi";

type OverlayPhase =
  | "idle"
  | "listening"
  | "processing"
  | "result"
  | "error"
  | "clarify"
  | "code-repair";

type CodeRepairPanel = {
  file: string;
  fileName: string;
  line: number;
  code: string;
  message: string;
  why: string;
  suggestedFix: string;
  before?: string;
  after?: string;
  hasSafePatch: boolean;
  projectRoot: string;
};

const LABELS: Record<OverlayPhase, string> = {
  idle: "Ready",
  listening: "Listening…",
  processing: "Processing…",
  result: "Done",
  error: "Error",
  clarify: "Pick one",
  "code-repair": "Error found",
};

export function OverlayPage() {
  const [phase, setPhase] = useState<OverlayPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [clarifyItems, setClarifyItems] = useState<
    Array<{ path: string; label: string }>
  >([]);
  const [clarifySpoken, setClarifySpoken] = useState("");
  const [clarifyQuestion, setClarifyQuestion] = useState<string | null>(null);
  const [repairPanel, setRepairPanel] = useState<CodeRepairPanel | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);

  const sessionIdRef = useRef<string | undefined>(undefined);
  const streamIdRef = useRef<string>("");
  const recordingRef = useRef(false);
  const busyRef = useRef(false);
  const voiceModeRef = useRef<"command" | "dictation">("command");
  const [voiceMode, setVoiceMode] = useState<"command" | "dictation">("command");

  const voice = useVoiceCapture();

  useEffect(() => {
    document.documentElement.classList.add("overlay-html");
    document.body.classList.add("overlay-shell");
    return () => {
      document.documentElement.classList.remove("overlay-html");
      document.body.classList.remove("overlay-shell");
    };
  }, []);

  useEffect(() => {
    void getRippleApi()
      .getSession()
      .then((s) => {
        sessionIdRef.current = s.sessionId;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const api = getRippleApi();
    const unsubShow = api.onDisambiguationShow?.(({ spoken, items }) => {
      setClarifySpoken(spoken);
      setClarifyItems(items);
      setPhase("clarify");
      setError(null);
    });
    const unsubHide = api.onDisambiguationHide?.(() => {
      setClarifyItems([]);
      setClarifySpoken("");
      setClarifyQuestion(null);
      setPhase("idle");
    });
    const unsubClarify = api.onClarifyQuestion?.(({ question }) => {
      setClarifyQuestion(question);
      setClarifyItems([]);
      setClarifySpoken("");
      setPhase("clarify");
      setError(null);
    });
    const unsubRepairShow = api.onCodeRepairShow?.((payload) => {
      setRepairPanel(payload);
      setPhase("code-repair");
      setError(null);
    });
    const unsubRepairHide = api.onCodeRepairHide?.(() => {
      setRepairPanel(null);
      setRepairBusy(false);
      setPhase("idle");
    });
    return () => {
      unsubShow?.();
      unsubHide?.();
      unsubClarify?.();
      unsubRepairShow?.();
      unsubRepairHide?.();
    };
  }, []);

  const runCommand = useCallback(async (text: string) => {
    const res = await getRippleApi().executeCommand({
      command: text,
      sessionId: sessionIdRef.current,
    });
    if (!res.ok) {
      throw new Error(res.message ?? "Command failed");
    }
    const data = res.data as {
      execution?: { allSucceeded: boolean };
    };
    setPhase(data.execution?.allSucceeded === false ? "error" : "result");
  }, []);

  const runDictation = useCallback(async (text: string) => {
    const res = await getRippleApi().executeDictation({ text, insert: true });
    if (!res.ok) {
      throw new Error(res.error ?? "Dictation failed");
    }
    console.info(
      `[ripple-overlay] dictation final (${res.correctionKind}):`,
      res.finalText,
    );
    setPhase("result");
  }, []);

  const cancelRecording = useCallback(async () => {
    busyRef.current = false;
    if (recordingRef.current) {
      recordingRef.current = false;
      await voice.stop();
      if (streamIdRef.current) {
        await getRippleApi().cancelVoice(streamIdRef.current).catch(() => undefined);
      }
    }
    await getRippleApi().setOverlayVoiceActive(false);
    setPhase("idle");
    setError(null);
  }, [voice]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current || busyRef.current) return;
    busyRef.current = true;
    recordingRef.current = false;
    setPhase("processing");

    try {
      const { buffer, mimeType, filename } = await voice.stopAndGetBuffer();

      const chunkRes = await getRippleApi().sendVoiceChunk({
        streamId: streamIdRef.current,
        sessionId: sessionIdRef.current,
        chunk: new Uint8Array(buffer),
        mimeType,
        filename,
      });
      if (!chunkRes.ok) {
        setError(chunkRes.message ?? "Failed to upload audio");
        setPhase("error");
        return;
      }

      const endRes = await getRippleApi().endVoice({
        streamId: streamIdRef.current,
        sessionId: sessionIdRef.current,
      });

      if (!endRes.ok) {
        setError(endRes.message ?? "Transcription failed");
        setPhase("error");
        return;
      }

      const text = (endRes.data as { text?: string } | undefined)?.text?.trim();
      if (!text) {
        setError("No speech detected");
        setPhase("error");
        return;
      }

      console.info("[ripple-overlay] transcript raw:", text);
      if (voiceModeRef.current === "dictation") {
        await runDictation(text);
      } else {
        await runCommand(text);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Command failed");
      setPhase("error");
    } finally {
      busyRef.current = false;
      await getRippleApi().setOverlayVoiceActive(false);
    }
  }, [runCommand, runDictation, voice]);

  const startRecording = useCallback(async () => {
    if (recordingRef.current || busyRef.current) return;

    setError(null);
    streamIdRef.current = crypto.randomUUID();
    recordingRef.current = true;

    await getRippleApi().setOverlayVoiceActive(true);
    setPhase("listening");

    try {
      await voice.start();
    } catch (e: unknown) {
      recordingRef.current = false;
      await getRippleApi().setOverlayVoiceActive(false);
      setError(
        e instanceof Error ? e.message : "Microphone permission denied",
      );
      setPhase("error");
    }
  }, [voice]);

  useEffect(() => {
    const api = getRippleApi();
    const unsubToggle = api.onVoiceToggle(({ action, mode }) => {
      if (mode === "command" || mode === "dictation") {
        voiceModeRef.current = mode;
        setVoiceMode(mode);
      }
      if (action === "start") {
        void startRecording();
        return;
      }
      if (action === "stop") {
        void stopRecording();
        return;
      }
      if (action === "cancel") {
        void cancelRecording();
      }
    });

    return () => {
      unsubToggle();
    };
  }, [cancelRecording, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        void voice.stop();
        void getRippleApi().setOverlayVoiceActive(false);
      }
    };
  }, [voice]);

  const label = error && phase === "error" ? error.slice(0, 40) : LABELS[phase];
  const modeBanner = voiceMode === "dictation" ? "Dictation" : "Command";
  const hotkeyHint =
    voiceMode === "dictation"
      ? "Alt+Space — stop · Esc — cancel"
      : "Ctrl+Space — stop · Esc — cancel";

  const pickClarify = useCallback(async (path: string) => {
    await getRippleApi().pickDisambiguation?.(path);
    setClarifyItems([]);
    setPhase("processing");
  }, []);

  const dismissClarify = useCallback(async () => {
    await getRippleApi().pickDisambiguation?.(null);
    setClarifyItems([]);
    setPhase("idle");
  }, []);

  const runRepairAction = useCallback(
    async (action: "open" | "apply" | "ignore") => {
      if (repairBusy) return;
      setRepairBusy(true);
      try {
        const res = await getRippleApi().codeRepairAction?.(action);
        if (!res?.ok && action !== "open") {
          setError(res?.error ?? "Action failed");
        }
        if (action === "ignore" || action === "apply") {
          setRepairPanel(null);
          setPhase(action === "apply" ? "processing" : "idle");
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Action failed");
      } finally {
        setRepairBusy(false);
      }
    },
    [repairBusy],
  );

  if (phase === "code-repair" && repairPanel) {
    return (
      <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-3">
        <p className="text-[11px] font-semibold tracking-wide text-rose-300">
          Error found
        </p>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto text-[11px] leading-snug text-zinc-200">
          <p>
            <span className="text-zinc-500">File </span>
            <span className="break-all text-zinc-100">{repairPanel.fileName}</span>
          </p>
          <p>
            <span className="text-zinc-500">Line </span>
            <span className="text-zinc-100">{repairPanel.line}</span>
            <span className="ml-2 text-zinc-500">{repairPanel.code}</span>
          </p>
          <p>
            <span className="text-zinc-500">Problem </span>
            {repairPanel.message}
          </p>
          <p>
            <span className="text-zinc-500">Why </span>
            {repairPanel.why}
          </p>
          <p>
            <span className="text-zinc-500">Suggested </span>
            {repairPanel.suggestedFix}
          </p>
          {repairPanel.before ? (
            <p className="rounded bg-zinc-900/80 px-1.5 py-1 font-mono text-[10px] text-amber-200/90">
              Before: {repairPanel.before}
            </p>
          ) : null}
          {repairPanel.after ? (
            <p className="rounded bg-zinc-900/80 px-1.5 py-1 font-mono text-[10px] text-emerald-300/90">
              After: {repairPanel.after}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={repairBusy}
            className="no-drag flex-1 rounded-md border border-zinc-600/50 bg-zinc-900/95 px-2 py-1.5 text-[11px] text-zinc-100 hover:border-zinc-400/60 disabled:opacity-50"
            onClick={() => void runRepairAction("open")}
          >
            Open in Cursor
          </button>
          <button
            type="button"
            disabled={repairBusy || !repairPanel.hasSafePatch}
            className="no-drag flex-1 rounded-md border border-emerald-500/40 bg-emerald-950/80 px-2 py-1.5 text-[11px] text-emerald-100 hover:border-emerald-400/70 disabled:opacity-40"
            onClick={() => void runRepairAction("apply")}
          >
            Apply Fix
          </button>
          <button
            type="button"
            disabled={repairBusy}
            className="no-drag rounded-md px-2 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            onClick={() => void runRepairAction("ignore")}
          >
            Ignore
          </button>
        </div>
      </div>
    );
  }

  if (phase === "clarify" && clarifyQuestion && clarifyItems.length === 0) {
    return (
      <div className="flex h-full w-full flex-col gap-1.5 p-2">
        <p className="text-[10px] font-medium text-violet-200/90">Need a detail</p>
        <p className="line-clamp-3 text-[11px] leading-snug text-zinc-100">
          {clarifyQuestion}
        </p>
        <p className="text-[10px] text-zinc-500">Press voice again and answer.</p>
      </div>
    );
  }

  if (phase === "clarify" && clarifyItems.length > 0) {
    return (
      <div className="flex h-full w-full flex-col gap-1.5 p-2">
        <p className="truncate text-[10px] font-medium text-violet-200/90">
          {clarifySpoken || "Which one?"}
        </p>
        {clarifyItems.map((item) => (
          <button
            key={item.path}
            type="button"
            className="no-drag truncate rounded-md border border-violet-500/30 bg-zinc-900/95 px-2 py-1.5 text-left text-[11px] text-zinc-100 hover:border-violet-400/60"
            onClick={() => void pickClarify(item.path)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="no-drag text-[10px] text-zinc-500 hover:text-zinc-300"
          onClick={() => void dismissClarify()}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      className="drag-region flex h-full w-full items-center justify-center"
      title={hotkeyHint}
    >
      <div className="voice-pill flex items-center gap-2.5 rounded-full border border-violet-500/40 bg-zinc-950/95 px-3.5 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.55),0_0_24px_rgba(124,58,237,0.2)]">
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            voiceMode === "dictation"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-violet-500/20 text-violet-300"
          }`}
        >
          {modeBanner}
        </span>
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center">
          {phase === "listening" ? (
            <>
              <span className="pulse-ring absolute inset-0 rounded-full bg-violet-500/40" />
              <span className="relative z-10 h-2.5 w-2.5 rounded-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.95)]" />
            </>
          ) : phase === "processing" ? (
            <span className="indicator-spinner h-5 w-5 rounded-full border-2 border-violet-400/30 border-t-violet-400" />
          ) : phase === "result" ? (
            <span className="text-sm font-semibold text-emerald-400">✓</span>
          ) : phase === "error" ? (
            <span className="text-sm font-bold text-amber-400">!</span>
          ) : (
            <span className="h-2 w-2 rounded-full bg-zinc-500" />
          )}
        </div>
        <span
          className={`max-w-[150px] truncate text-xs font-medium ${
            phase === "error" ? "text-amber-300" : "text-zinc-100"
          }`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
