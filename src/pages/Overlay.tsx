import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceCapture } from "../hooks/useVoiceCapture";
import { getRippleApi } from "../lib/rippleApi";

type OverlayPhase =
  | "idle"
  | "listening"
  | "processing"
  | "result"
  | "error";

const LABELS: Record<OverlayPhase, string> = {
  idle: "Ready",
  listening: "Listening…",
  processing: "Processing…",
  result: "Done",
  error: "Error",
};

export function OverlayPage() {
  const [phase, setPhase] = useState<OverlayPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const sessionIdRef = useRef<string | undefined>(undefined);
  const streamIdRef = useRef<string>("");
  const recordingRef = useRef(false);
  const busyRef = useRef(false);

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

      console.info("[ripple-overlay] transcript:", text);
      await runCommand(text);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Command failed");
      setPhase("error");
    } finally {
      busyRef.current = false;
      await getRippleApi().setOverlayVoiceActive(false);
    }
  }, [runCommand, voice]);

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
    const unsubToggle = api.onVoiceToggle(({ action }) => {
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

  return (
    <div
      className="drag-region flex h-full w-full items-center justify-center"
      title="Ctrl+Space — stop · Esc — cancel"
    >
      <div className="voice-pill flex items-center gap-2.5 rounded-full border border-violet-500/40 bg-zinc-950/95 px-3.5 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.55),0_0_24px_rgba(124,58,237,0.2)]">
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
