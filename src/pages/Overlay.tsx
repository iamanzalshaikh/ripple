import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceCapture } from "../hooks/useVoiceCapture";
import { getRippleApi } from "../lib/rippleApi";
import { LANGUAGES } from "../lib/languages";
import { FlowBar, type FlowBarMode, type FlowBarPhase } from "../components/FlowBar";
import { inferCleanupTags, type CleanupTag } from "../lib/cleanupTags";

type OverlayPhase =
  | "idle"
  | "listening"
  | "processing"
  | "result"
  | "error"
  | "clarify"
  | "code-repair"
  | "meeting-consent";

type MeetingUiState = {
  state: "idle" | "recording" | "stopping";
  elapsedMs: number;
  lastTranscriptSnippet: string | null;
  error: string | null;
};

const MEETING_FLUSH_MS = 10_000;

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
  "meeting-consent": "Meeting privacy",
};

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

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
  /** P7.8 — periodic voice:flush while dictation is listening. */
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceModeRef = useRef<"command" | "dictation" | "transform" | "meeting">(
    "command",
  );
  const [voiceMode, setVoiceMode] = useState<
    "command" | "dictation" | "transform" | "meeting"
  >("command");
  const [sessionInfo, setSessionInfo] = useState<{
    utteranceCount: number;
    remainingMs: number;
  } | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [bootMessage, setBootMessage] = useState<string | null>(null);
  const [cleanupTags, setCleanupTags] = useState<CleanupTag[]>([]);

  // P10.2 — Meeting Notetaker.
  const meetingActiveRef = useRef(false);
  const meetingStoppingRef = useRef(false);
  const [meetingUi, setMeetingUi] = useState<MeetingUiState | null>(null);
  const meetingTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [meetingConsentOpen, setMeetingConsentOpen] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [meetingCaptureMode, setMeetingCaptureMode] = useState<
    "mic+system" | "mic-only" | null
  >(null);

  // P11.2 — Flow Bar language picker.
  const [currentLangCode, setCurrentLangCode] = useState("auto");
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [langBusy, setLangBusy] = useState(false);
  const [langCustomInput, setLangCustomInput] = useState("");

  const voice = useVoiceCapture();
  // Stable ref — useVoiceCapture returns a new object every render; putting
  // `voice` in effect deps was killing the meeting MediaRecorder + timer on
  // every setState (live: RECORDING 0:00 stuck, finalBytes=0).
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

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
    void getRippleApi()
      .language.get()
      .then((res) => {
        if (res.ok && res.language) setCurrentLangCode(res.language);
      })
      .catch(() => undefined);
  }, []);

  const openLanguageMenu = useCallback(async () => {
    // Re-fetch fresh in case it was changed from the full Language settings
    // page since this bar last loaded.
    const res = await getRippleApi().language.get().catch(() => ({
      ok: false as const,
      language: undefined,
    }));
    if (res.ok && res.language) setCurrentLangCode(res.language);
    setLangCustomInput("");
    setLangMenuOpen(true);
    await getRippleApi().expandLanguageMenu(LANGUAGES.length + 1);
  }, []);

  const closeLanguageMenu = useCallback(async () => {
    setLangMenuOpen(false);
    await getRippleApi().collapseToIndicator();
  }, []);

  const selectLanguage = useCallback(
    async (code: string) => {
      const trimmed = code.trim().toLowerCase();
      if (!trimmed || langBusy) return;
      setLangBusy(true);
      try {
        const res = await getRippleApi().language.set(trimmed);
        if (res.ok) setCurrentLangCode(res.language ?? trimmed);
      } finally {
        setLangBusy(false);
        await closeLanguageMenu();
      }
    },
    [closeLanguageMenu, langBusy],
  );

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
    const unsubTransformHint = api.onIpcEvent?.(
      "overlay:transform-hint",
      (payload) => {
        const msg =
          payload &&
          typeof payload === "object" &&
          "message" in payload &&
          typeof (payload as { message: unknown }).message === "string"
            ? (payload as { message: string }).message
            : "Select text first, then F9";
        setVoiceMode("transform");
        voiceModeRef.current = "transform";
        setError(msg);
        setPhase("error");
      },
    );
    const unsubBoot = api.onIpcEvent?.("overlay:boot", (payload) => {
      const ready =
        payload &&
        typeof payload === "object" &&
        "ready" in payload &&
        (payload as { ready: unknown }).ready === true;
      if (ready) {
        setBootMessage(null);
        setPhase("idle");
        return;
      }
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof (payload as { message: unknown }).message === "string"
          ? (payload as { message: string }).message
          : "Starting up…";
      setBootMessage(message);
      setPhase("processing");
    });
    return () => {
      unsubShow?.();
      unsubHide?.();
      unsubClarify?.();
      unsubRepairShow?.();
      unsubRepairHide?.();
      unsubTransformHint?.();
      unsubBoot?.();
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

  const runDictation = useCallback(
    async (
      text: string,
      langOpts?: { requestedLanguage?: string; detectedLanguage?: string },
    ) => {
      const res = await getRippleApi().executeDictation({
        text,
        insert: true,
        requestedLanguage: langOpts?.requestedLanguage,
        detectedLanguage: langOpts?.detectedLanguage,
      });
      if (res.session) {
        setSessionInfo({
          utteranceCount: res.session.utteranceCount,
          remainingMs: res.session.remainingMs,
        });
      }
      if (!res.ok) {
        const raw = res.error ?? (res.transform ? "Transform failed" : "Dictation failed");
        const friendly =
          /restore_failed|no_focus_target|insert_aborted/i.test(raw)
            ? "Couldn't reach the target window — click the field and try again"
            : raw;
        setError(friendly);
        setCleanupTags([]);
        setPhase("error");
        return;
      }
      if (res.transform) {
        if (import.meta.env.DEV) {
          console.info(
            "[ripple-overlay] transform applied:",
            res.originalText,
            "→",
            res.finalText,
          );
        }
        setCleanupTags([]);
      } else {
        if (import.meta.env.DEV) {
          console.info(
            `[ripple-overlay] dictation final (${res.correctionKind}):`,
            res.finalText,
          );
        }
        setCleanupTags(
          inferCleanupTags({
            original: text,
            final: res.finalText,
            correctionKind: res.correctionKind,
          }),
        );
      }
      setPhase("result");
    },
    [],
  );

  const cancelRecording = useCallback(async () => {
    busyRef.current = false;
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (recordingRef.current) {
      recordingRef.current = false;
      await voice.stop();
      if (streamIdRef.current) {
        await getRippleApi().cancelVoice(streamIdRef.current).catch(() => undefined);
      }
    }
    await getRippleApi().streaming.clear().catch(() => undefined);
    await getRippleApi().setOverlayVoiceActive(false);
    setCleanupTags([]);
    setPhase("idle");
    setError(null);
  }, [voice]);

  const stopRecording = useCallback(async () => {
    if (!recordingRef.current || busyRef.current) return;
    busyRef.current = true;
    recordingRef.current = false;
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setPhase("processing");

    try {
      const { buffer, mimeType, filename, alreadyStreamed } =
        await voice.stopAndGetBuffer();

      // P9.5 — read the language picker fresh each time (cheap local read) so
      // a change takes effect on the very next utterance, no cross-window
      // sync needed. Runs alongside the chunk upload to avoid adding latency.
      const languageRes = await getRippleApi()
        .language.get()
        .catch(() => ({ ok: false as const, language: undefined }));

      const languageHint =
        languageRes.ok && languageRes.language && languageRes.language !== "auto"
          ? languageRes.language
          : undefined;

      // P7.8 — if chunks were streamed during recording, don't re-upload the
      // full blob (would double the server buffer). Only upload when batch.
      if (!alreadyStreamed) {
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
      } else {
        // Final tiny flush so trailing audio is transcribed before voice:end.
        await getRippleApi()
          .flushVoice({
            streamId: streamIdRef.current,
            sessionId: sessionIdRef.current,
            language: languageHint,
          })
          .catch(() => undefined);
      }

      const endRes = await getRippleApi().endVoice({
        streamId: streamIdRef.current,
        sessionId: sessionIdRef.current,
        language: languageHint,
      });

      if (!endRes.ok) {
        setError(endRes.message ?? "Transcription failed");
        setPhase("error");
        return;
      }

      const endData = endRes.data as { text?: string; language?: string } | undefined;
      const text = endData?.text?.trim();
      if (!text) {
        setError("No speech detected");
        setPhase("error");
        return;
      }
      // P9.5 — Whisper's own detected language, distinct from what the
      // picker requested; surfaced so a wrong auto-guess is visible instead
      // of just producing silently-bad text.
      const detectedLanguage = endData?.language;
      setDetectedLanguage(detectedLanguage ?? null);

      if (import.meta.env.DEV) {
        console.info("[ripple-overlay] transcript raw:", text);
      }
      // Transforms reuses the dictation IPC/pipeline end to end — the main
      // process routes to the rewrite path via the stashed selection, not
      // anything decided here.
      if (voiceModeRef.current === "dictation" || voiceModeRef.current === "transform") {
        await runDictation(text, {
          requestedLanguage: languageHint ?? "auto",
          detectedLanguage,
        });
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
    if (meetingActiveRef.current) return;

    setError(null);
    streamIdRef.current = crypto.randomUUID();
    recordingRef.current = true;

    await getRippleApi().setOverlayVoiceActive(true);
    setCleanupTags([]);
    setPhase("listening");

    // P7.8 PAUSED — no live chunk upload / flush / progressive insert.
    // Batch path: upload once on stop → voice:end → insert (pre-7.8 behavior).
    try {
      // P9.6 — read fresh each time, same reasoning as the language pref:
      // cheap local read, always reflects the latest toggle with no
      // cross-window state sync needed.
      const quietRes = await getRippleApi().quietMode.get().catch(() => ({
        ok: false as const,
        quietMode: undefined,
      }));
      const quietOn = quietRes.ok ? quietRes.quietMode === true : false;
      const micRes = await getRippleApi().micDevice.get().catch(() => ({
        ok: false as const,
        deviceId: undefined,
      }));
      const micDeviceId =
        micRes.ok && micRes.deviceId ? micRes.deviceId : undefined;
      console.info(
        `[ripple-overlay] mic capture quietMode=${quietOn ? "ON" : "OFF"} deviceId=${micDeviceId ?? "default"} streaming=OFF`,
      );

      await voice.start({
        quiet: quietOn,
        deviceId: micDeviceId,
      });
    } catch (e: unknown) {
      recordingRef.current = false;
      if (flushTimerRef.current) {
        clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      await getRippleApi().streaming.clear().catch(() => undefined);
      await getRippleApi().setOverlayVoiceActive(false);
      setError(
        e instanceof Error ? e.message : "Microphone permission denied",
      );
      setPhase("error");
    }
  }, [voice]);

  const clearMeetingTick = useCallback(() => {
    if (meetingTickRef.current) {
      clearInterval(meetingTickRef.current);
      meetingTickRef.current = null;
    }
  }, []);

  const startMeetingCapture = useCallback(async () => {
    if (meetingActiveRef.current || recordingRef.current || busyRef.current) {
      return;
    }
    meetingActiveRef.current = true;
    meetingStoppingRef.current = false;
    voiceModeRef.current = "meeting";
    setVoiceMode("meeting");
    setError(null);
    setPhase("listening");
    setMeetingCaptureMode(null);
    setMeetingUi({
      state: "recording",
      elapsedMs: 0,
      lastTranscriptSnippet: null,
      error: null,
    });

    clearMeetingTick();
    const startedAt = Date.now();
    meetingTickRef.current = setInterval(() => {
      setMeetingUi((prev) =>
        prev
          ? { ...prev, elapsedMs: Date.now() - startedAt }
          : {
              state: "recording",
              elapsedMs: Date.now() - startedAt,
              lastTranscriptSnippet: null,
              error: null,
            },
      );
    }, 1000);

    try {
      const quietRes = await getRippleApi().quietMode.get().catch(() => ({
        ok: false as const,
        quietMode: undefined,
      }));
      const quietOn = quietRes.ok ? quietRes.quietMode === true : false;
      console.info(
        `[ripple-overlay] meeting capture quietMode=${quietOn ? "ON" : "OFF"} flush=${MEETING_FLUSH_MS}ms systemAudio=OFF (DXGI unreliable)`,
      );

      // Mic-only: getDisplayMedia/loopback hits DXGI Duplicationfailed on this
      // machine and previously blocked the recorder entirely (0 transcript).
      await voiceRef.current.start({
        quiet: quietOn,
        continuous: true,
        flushInterval: MEETING_FLUSH_MS,
        includeSystemAudio: false,
        onCaptureMode: (mode) => {
          setMeetingCaptureMode(mode);
          console.info(`[ripple-overlay] meeting capture ready mode=${mode}`);
        },
        onFlush: (result) => {
          console.info(
            `[ripple-overlay] meeting flush bytes=${result.buffer.byteLength}`,
          );
          void getRippleApi()
            .meeting.sendChunk({
              chunk: new Uint8Array(result.buffer),
              mimeType: result.mimeType,
              filename: result.filename,
            })
            .then((res) => {
              if (res.ok && res.text) {
                setMeetingUi((prev) =>
                  prev
                    ? {
                        ...prev,
                        lastTranscriptSnippet: res.text!.slice(0, 120),
                      }
                    : prev,
                );
              } else if (!res.ok) {
                console.warn(
                  `[ripple-overlay] meeting chunk failed: ${res.message ?? "unknown"}`,
                );
              }
            })
            .catch(() => undefined);
        },
      });
      console.info("[ripple-overlay] meeting MediaRecorder started");
    } catch (e: unknown) {
      meetingActiveRef.current = false;
      clearMeetingTick();
      setMeetingUi(null);
      setMeetingCaptureMode(null);
      setVoiceMode("command");
      voiceModeRef.current = "command";
      setError(
        e instanceof Error ? e.message : "Microphone permission denied",
      );
      setPhase("error");
    }
  }, [clearMeetingTick]);

  const stopMeetingCapture = useCallback(async () => {
    if (!meetingActiveRef.current || meetingStoppingRef.current) return;
    meetingStoppingRef.current = true;
    setPhase("processing");
    setMeetingUi((prev) =>
      prev ? { ...prev, state: "stopping" } : prev,
    );
    clearMeetingTick();

    try {
      let finalArgs:
        | { chunk: Uint8Array; mimeType?: string; filename?: string }
        | undefined;
      try {
        const result = await voiceRef.current.stopAndGetBuffer();
        finalArgs = {
          chunk: new Uint8Array(result.buffer),
          mimeType: result.mimeType,
          filename: result.filename,
        };
        console.info(
          `[ripple-overlay] meeting stop buffer bytes=${result.buffer.byteLength}`,
        );
      } catch (e) {
        console.warn(
          `[ripple-overlay] meeting stop buffer failed:`,
          e instanceof Error ? e.message : e,
        );
      }

      const endRes = await getRippleApi().meeting.end(finalArgs);
      if (!endRes.ok) {
        setError(endRes.message ?? "Failed to save meeting");
        setPhase("error");
      } else {
        setPhase("result");
        setTimeout(() => setPhase("idle"), 2000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Meeting stop failed");
      setPhase("error");
    } finally {
      meetingActiveRef.current = false;
      meetingStoppingRef.current = false;
      setMeetingUi(null);
      setMeetingCaptureMode(null);
      voiceModeRef.current = "command";
      setVoiceMode("command");
    }
  }, [clearMeetingTick]);

  useEffect(() => {
    const api = getRippleApi();
    const unsubToggle = api.onVoiceToggle(({ action, mode }) => {
      if (meetingActiveRef.current) return;
      if (mode === "command" || mode === "dictation" || mode === "transform") {
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
    const api = getRippleApi();
    const unsubMeeting = api.onMeetingToggle?.(({ action }) => {
      if (action === "start") {
        void startMeetingCapture();
        return;
      }
      if (action === "stop") {
        void stopMeetingCapture();
      }
    });
    const unsubConsent = api.onMeetingConsent?.(({ show }) => {
      setMeetingConsentOpen(show);
      if (show) setPhase("meeting-consent");
      else if (!meetingActiveRef.current) setPhase("idle");
    });
    const unsubState = api.onMeetingState?.((snap) => {
      if (snap.state === "idle") {
        setMeetingUi(null);
        return;
      }
      setMeetingUi({
        state: snap.state,
        elapsedMs: snap.elapsedMs,
        lastTranscriptSnippet: snap.lastTranscriptSnippet,
        error: snap.error,
      });
    });
    return () => {
      unsubMeeting?.();
      unsubConsent?.();
      unsubState?.();
    };
  }, [startMeetingCapture, stopMeetingCapture]);

  const acceptMeetingConsent = useCallback(async () => {
    if (consentBusy) return;
    setConsentBusy(true);
    try {
      const res = await getRippleApi().meeting.acceptConsent();
      if (!res.ok) {
        setError(res.message ?? "Could not start meeting");
        setPhase("error");
      }
      setMeetingConsentOpen(false);
    } finally {
      setConsentBusy(false);
    }
  }, [consentBusy]);

  const declineMeetingConsent = useCallback(async () => {
    if (consentBusy) return;
    setConsentBusy(true);
    try {
      await getRippleApi().meeting.declineConsent();
      setMeetingConsentOpen(false);
      setPhase("idle");
    } finally {
      setConsentBusy(false);
    }
  }, [consentBusy]);

  useEffect(() => {
    return () => {
      // Unmount only — do NOT depend on `voice` (new object every render).
      if (recordingRef.current) {
        void voiceRef.current.stop();
        void getRippleApi().setOverlayVoiceActive(false);
      }
      if (meetingActiveRef.current) {
        void voiceRef.current.stop();
      }
      clearMeetingTick();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only cleanup
  }, []);

  const isMeetingMode = voiceMode === "meeting" || Boolean(meetingUi);
  const meetingLabel =
    meetingUi?.state === "stopping"
      ? "Saving meeting…"
      : meetingUi
        ? `Recording ${formatElapsed(meetingUi.elapsedMs)}${
            meetingCaptureMode === "mic+system"
              ? " · mic+sys"
              : meetingCaptureMode === "mic-only"
                ? " · mic"
                : ""
          }`
        : "Meeting…";
  const label =
    bootMessage
      ? bootMessage
      : isMeetingMode && meetingUi
        ? meetingLabel
        : error && phase === "error"
          ? error.slice(0, 120)
          : phase === "processing" && voiceMode === "dictation"
            ? "Cleaning up…"
            : LABELS[phase];
  const sessionBadge =
    voiceMode === "dictation" && sessionInfo
      ? `${sessionInfo.utteranceCount} · ${Math.max(1, Math.ceil(sessionInfo.remainingMs / 60_000))}m left`
      : null;
  // P9.5 — surfaces Whisper's own detected language so a wrong auto-guess
  // is visible instead of just producing silently-bad text.
  const languageBadge =
    phase === "result" && detectedLanguage ? `detected: ${detectedLanguage}` : null;
  const hotkeyHint = isMeetingMode
    ? "Ctrl+Shift+M — stop · Esc cancels voice only"
    : voiceMode === "transform"
      ? "F9 — stop · Esc — cancel"
      : "Shift+Space — stop · Esc — cancel";
  const flowBarMode: FlowBarMode = isMeetingMode ? "meeting" : voiceMode;
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

  if (meetingConsentOpen || phase === "meeting-consent") {
    return (
      <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-3">
        <p className="text-[11px] font-semibold tracking-wide text-rose-300">
          Meeting recording
        </p>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto text-[11px] leading-snug text-zinc-200">
          <p>
            Ripple will record your <span className="text-zinc-100">microphone</span> and
            send audio to Ripple servers (OpenAI) for transcription and summary.
          </p>
          <p className="text-zinc-400">
            A red recording indicator stays on the Flow Bar. Stop anytime with
            Ctrl+Shift+M or Stop. Speak for at least ~10 seconds so a transcript
            chunk can land.
          </p>
          <p className="text-zinc-500">
            By continuing you consent to this processing. System-audio capture
            (other participants) is temporarily off on Windows GPUs that fail
            DXGI loopback — mic-only is used for reliability.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            disabled={consentBusy}
            className="no-drag flex-1 rounded-md border border-rose-500/40 bg-rose-950/80 px-2 py-1.5 text-[11px] text-rose-100 hover:border-rose-400/70 disabled:opacity-50"
            onClick={() => void acceptMeetingConsent()}
          >
            Start recording
          </button>
          <button
            type="button"
            disabled={consentBusy}
            className="no-drag rounded-md px-2 py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            onClick={() => void declineMeetingConsent()}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (langMenuOpen) {
    return (
      <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-2.5">
        <div className="flex shrink-0 items-center justify-between">
          <p className="text-[10px] font-medium uppercase tracking-wide text-violet-200/90">
            Dictation language
          </p>
          <button
            type="button"
            className="no-drag text-[10px] text-zinc-500 hover:text-zinc-300"
            onClick={() => void closeLanguageMenu()}
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {LANGUAGES.map((lang) => {
            const active = lang.code === currentLangCode;
            return (
              <button
                key={lang.code}
                type="button"
                disabled={langBusy}
                onClick={() => void selectLanguage(lang.code)}
                className={`no-drag flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] transition disabled:opacity-50 ${
                  active
                    ? "bg-violet-950/60 text-white"
                    : "text-zinc-300 hover:bg-zinc-900"
                }`}
              >
                {lang.label}
                {active ? <span className="text-violet-400">✓</span> : null}
              </button>
            );
          })}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <input
            type="text"
            value={langCustomInput}
            onChange={(e) => setLangCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void selectLanguage(langCustomInput);
            }}
            placeholder="Other (ISO code, e.g. it)"
            maxLength={8}
            className="no-drag min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={langBusy || !langCustomInput.trim()}
            onClick={() => void selectLanguage(langCustomInput)}
            className="no-drag rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Set
          </button>
        </div>
      </div>
    );
  }

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
    <FlowBar
      mode={flowBarMode}
      // Safe: "clarify" / "code-repair" phases return earlier above, so by
      // this point `phase` can only be one of FlowBarPhase's five values.
      phase={phase as FlowBarPhase}
      statusText={label}
      hotkeyHint={hotkeyHint}
      languageCode={currentLangCode}
      languageBusy={langBusy}
      onOpenLanguageMenu={() => void openLanguageMenu()}
      onOpenScratchpad={() => {
        void getRippleApi().flowBar.openScratchpad();
      }}
      onStartTransform={() => {
        void getRippleApi().flowBar.startTransform();
      }}
      onStopMeeting={() => {
        void stopMeetingCapture();
      }}
      sessionBadge={sessionBadge}
      detectedLanguageBadge={languageBadge}
      meetingSnippet={meetingUi?.lastTranscriptSnippet ?? null}
      cleanupTags={phase === "result" ? cleanupTags : []}
    />
  );
}
