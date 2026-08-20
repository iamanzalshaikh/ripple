import { useCallback, useRef } from "react";

const CHUNK_MS = 300;
/**
 * P9.6 — quiet/whisper mode gain boost. Whisper-level speech sits well below
 * normal talking volume (roughly 3-8x quieter in amplitude); autoGainControl
 * alone targets normal speech loudness and often isn't aggressive enough on
 * its own, so we add a fixed software boost on top of it via a Web Audio
 * GainNode before the recorder ever sees the signal.
 */
const QUIET_MODE_GAIN = 3.0;

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export interface VoiceRecordingResult {
  buffer: ArrayBuffer;
  mimeType: string;
  filename: string;
}

function filenameForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes("ogg")) return "voice.ogg";
  if (m.includes("mp4") || m.includes("mpeg")) return "voice.mp4";
  if (m.includes("wav")) return "voice.wav";
  return "voice.webm";
}

const SYSTEM_AUDIO_LABEL =
  /stereo mix|loopback|wave out|what u hear|system audio|virtual audio/i;

function buildMicConstraints(
  quiet: boolean,
  deviceId?: string,
): MediaTrackConstraints | boolean {
  const processing: MediaTrackConstraints = quiet
    ? {
        autoGainControl: true,
        noiseSuppression: false,
        echoCancellation: false,
      }
    : {
        autoGainControl: true,
        noiseSuppression: true,
        echoCancellation: true,
      };

  if (deviceId) {
    return { ...processing, deviceId: { ideal: deviceId } };
  }
  return processing;
}

function logMicTrack(stream: MediaStream, quiet: boolean): void {
  const track = stream.getAudioTracks()[0];
  if (!track) {
    console.warn("[ripple-voice] mic track missing after getUserMedia");
    return;
  }
  const label = track.label || "unknown";
  const settings = track.getSettings();
  console.info(
    `[ripple-voice] mic label="${label}" deviceId=${settings.deviceId ?? "?"} quiet=${quiet}`,
  );
  if (SYSTEM_AUDIO_LABEL.test(label)) {
    console.warn(
      `[ripple-voice] "${label}" records system/loopback audio — open Language → Microphone and pick your headset mic`,
    );
  }
}

export interface VoiceCaptureStartOptions {
  /** P9.6 — boost + de-noise-suppress for soft/whispered speech. */
  quiet?: boolean;
  /** Saved MediaDevices audioinput id — avoids Windows default (often Stereo Mix). */
  deviceId?: string;
  /**
   * P7.8 — called for each MediaRecorder timeslice while recording so the
   * client can upload chunks for mid-utterance `voice:flush` partials.
   */
  onChunk?: (chunk: ArrayBuffer, mimeType: string) => void;
  /**
   * P10.2 — Meeting Notetaker: keep the mic open until explicitly stopped
   * (no release-to-stop). Combined with `flushInterval` + `onFlush`.
   */
  continuous?: boolean;
  /**
   * P10.2 — every N ms, stop+restart the recorder and deliver a complete
   * audio blob via `onFlush` (needed because mid-stream WebM slices are not
   * independently valid without the container header).
   */
  flushInterval?: number;
  /** Called with each flushed interval blob during continuous mode. */
  onFlush?: (result: VoiceRecordingResult) => void;
  /**
   * P10.2 — mix WASAPI loopback (system audio / other participants) with mic.
   * Falls back to mic-only if loopback fails.
   */
  includeSystemAudio?: boolean;
  /** Fired once after start with whether system audio was actually mixed in. */
  onCaptureMode?: (mode: "mic+system" | "mic-only") => void;
}

export function useVoiceCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const partsRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("audio/webm");
  const onChunkRef = useRef<VoiceCaptureStartOptions["onChunk"]>(undefined);
  /** True when chunks were already uploaded during recording (skip full re-upload on stop). */
  const streamedChunksRef = useRef(false);
  const continuousRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFlushRef = useRef<VoiceCaptureStartOptions["onFlush"]>(undefined);
  const startOptionsRef = useRef<VoiceCaptureStartOptions | undefined>(undefined);
  const flushingRef = useRef(false);
  /** Keep mic/audio graph alive across continuous flush restarts. */
  const keepTracksRef = useRef(false);
  const systemStreamRef = useRef<MediaStream | null>(null);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // The recorded stream is a synthetic WebAudio destination in quiet mode —
    // stopping its tracks doesn't release the physical mic, so stop that too.
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    systemStreamRef.current?.getTracks().forEach((t) => t.stop());
    systemStreamRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  }, []);

  async function acquireSystemAudioStream(): Promise<MediaStream | null> {
    const api = window.ripple;
    if (!api?.loopback?.enable) return null;

    const TIMEOUT_MS = 2500;
    let settled = false;

    try {
      await api.loopback.enable();

      const stream = await new Promise<MediaStream | null>((resolve) => {
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            console.warn(
              "[ripple-voice] system audio timed out — continuing mic-only",
            );
            resolve(null);
          }
        }, TIMEOUT_MS);

        void navigator.mediaDevices
          .getDisplayMedia({ video: true, audio: true })
          .then((s) => {
            if (settled) {
              // Late resolve after timeout — tear down so DXGI doesn't keep failing.
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(s);
          })
          .catch((e) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            console.warn(
              "[ripple-voice] system audio getDisplayMedia failed:",
              e instanceof Error ? e.message : e,
            );
            resolve(null);
          });
      });

      await api.loopback.disable().catch(() => undefined);

      if (!stream) return null;

      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      return stream;
    } catch (e) {
      console.warn(
        "[ripple-voice] system audio loopback unavailable:",
        e instanceof Error ? e.message : e,
      );
      try {
        await window.ripple?.loopback?.disable();
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const attachRecorder = useCallback((recordStream: MediaStream) => {
    const preferred = pickMimeType();
    const recorder = new MediaRecorder(
      recordStream,
      preferred ? { mimeType: preferred } : undefined,
    );
    recorderRef.current = recorder;
    partsRef.current = [];
    // Do NOT clear streamedChunksRef here — continuous flush restarts call
    // attachRecorder and must keep alreadyStreamed=true for stopAndGetBuffer.

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) {
        partsRef.current.push(ev.data);
        const cb = onChunkRef.current;
        if (cb) {
          streamedChunksRef.current = true;
          void ev.data.arrayBuffer().then((buf) => {
            cb(buf, mimeTypeRef.current);
          });
        }
      }
    };

    recorder.start(CHUNK_MS);
    mimeTypeRef.current = recorder.mimeType || preferred || "audio/webm";
  }, []);

  /** Stop MediaRecorder and return blob; leave mic tracks running if continuous. */
  const stopRecorderOnly = useCallback(async (): Promise<VoiceRecordingResult> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      throw new Error("Not recording");
    }

    await new Promise<void>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve();
        },
        { once: true },
      );
      try {
        recorder.requestData();
      } catch {
        /* ignore */
      }
      recorder.stop();
    });

    recorderRef.current = null;

    const mimeType = mimeTypeRef.current || recorder.mimeType || "audio/webm";
    const blob = new Blob(partsRef.current, { type: mimeType });
    partsRef.current = [];
    // Continuous flush uploads this slice — mark streamed so stop path
    // knows chunks already hit the backend (do not reset to false).
    streamedChunksRef.current = true;

    if (!blob.size) {
      throw new Error("No audio captured");
    }

    return {
      buffer: await blob.arrayBuffer(),
      mimeType,
      filename: filenameForMime(mimeType),
    };
  }, []);

  const startRecorderOnExistingStream = useCallback(async () => {
    const recordStream = streamRef.current;
    if (!recordStream) {
      throw new Error("No active media stream");
    }
    // Re-bind the chunk callback from the original start options.
    onChunkRef.current = startOptionsRef.current?.onChunk;
    attachRecorder(recordStream);
  }, [attachRecorder]);

  const start = useCallback(
    async (options?: VoiceCaptureStartOptions): Promise<void> => {
      const quiet = options?.quiet === true;
      const deviceId = options?.deviceId?.trim() || undefined;
      onChunkRef.current = options?.onChunk;
      onFlushRef.current = options?.onFlush;
      continuousRef.current = options?.continuous === true;
      startOptionsRef.current = options;
      streamedChunksRef.current = false;
      clearFlushTimer();

      // If we already hold a mic stream (continuous flush restart), reuse it.
      if (streamRef.current && keepTracksRef.current) {
        attachRecorder(streamRef.current);
      } else {
        // Mic + optional system audio in PARALLEL so DXGI loopback failures
        // cannot block mic recording (live bug: meeting ended with 0 transcript).
        const wantSystem = options?.includeSystemAudio === true;
        const micPromise = navigator.mediaDevices.getUserMedia({
          audio: buildMicConstraints(quiet, deviceId),
        });
        const systemPromise = wantSystem
          ? acquireSystemAudioStream()
          : Promise.resolve(null);

        const [micStream, systemStream] = await Promise.all([
          micPromise,
          systemPromise,
        ]);
        micStreamRef.current = micStream;
        logMicTrack(micStream, quiet);
        partsRef.current = [];

        let recordStream = micStream;
        let captureMode: "mic+system" | "mic-only" = "mic-only";

        if (systemStream) {
          systemStreamRef.current = systemStream;
        }

        const needsGraph = quiet || Boolean(systemStream);
        if (needsGraph) {
          const AudioCtx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          const audioContext = new AudioCtx();
          audioContextRef.current = audioContext;
          const destination = audioContext.createMediaStreamDestination();

          const micSource = audioContext.createMediaStreamSource(micStream);
          const micGain = audioContext.createGain();
          micGain.gain.value = quiet ? QUIET_MODE_GAIN : 1;
          micSource.connect(micGain);
          micGain.connect(destination);

          if (systemStream) {
            const sysSource =
              audioContext.createMediaStreamSource(systemStream);
            const sysGain = audioContext.createGain();
            sysGain.gain.value = 0.9;
            sysSource.connect(sysGain);
            sysGain.connect(destination);
            captureMode = "mic+system";
          }

          recordStream = destination.stream;
        }

        options?.onCaptureMode?.(captureMode);
        console.info(`[ripple-voice] capture mode=${captureMode}`);

        streamRef.current = recordStream;
        attachRecorder(recordStream);
      }

      keepTracksRef.current = continuousRef.current;

      const flushMs = options?.flushInterval;
      if (
        continuousRef.current &&
        typeof flushMs === "number" &&
        flushMs > 0 &&
        options?.onFlush
      ) {
        flushTimerRef.current = setInterval(() => {
          void (async () => {
            if (flushingRef.current) return;
            if (!recorderRef.current || recorderRef.current.state !== "recording") {
              return;
            }
            flushingRef.current = true;
            try {
              const result = await stopRecorderOnly();
              onFlushRef.current?.(result);
              if (continuousRef.current && streamRef.current) {
                await startRecorderOnExistingStream();
              }
            } catch (e) {
              console.warn(
                "[ripple-voice] continuous flush failed:",
                e instanceof Error ? e.message : e,
              );
            } finally {
              flushingRef.current = false;
            }
          })();
        }, flushMs);
      }
    },
    [
      attachRecorder,
      clearFlushTimer,
      startRecorderOnExistingStream,
      stopRecorderOnly,
    ],
  );
  const stopAndGetBuffer = useCallback(async (): Promise<
    VoiceRecordingResult & { alreadyStreamed: boolean }
  > => {
    clearFlushTimer();
    continuousRef.current = false;
    keepTracksRef.current = false;
    onFlushRef.current = undefined;

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      stopTracks();
      partsRef.current = [];
      throw new Error("Not recording");
    }

    const alreadyStreamed = streamedChunksRef.current;

    await new Promise<void>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve();
        },
        { once: true },
      );
      try {
        recorder.requestData();
      } catch {
        /* ignore */
      }
      recorder.stop();
    });

    recorderRef.current = null;
    stopTracks();
    onChunkRef.current = undefined;

    const mimeType = mimeTypeRef.current || recorder.mimeType || "audio/webm";
    const blob = new Blob(partsRef.current, { type: mimeType });
    partsRef.current = [];
    streamedChunksRef.current = false;

    if (!blob.size) {
      throw new Error("No audio captured");
    }

    return {
      buffer: await blob.arrayBuffer(),
      mimeType,
      filename: filenameForMime(mimeType),
      alreadyStreamed,
    };
  }, [clearFlushTimer, stopTracks]);

  const stop = useCallback(async (): Promise<void> => {
    try {
      await stopAndGetBuffer();
    } catch {
      /* discard */
    }
  }, [stopAndGetBuffer]);

  const isRecording = useCallback(() => {
    const r = recorderRef.current;
    return Boolean(r && r.state === "recording") || continuousRef.current;
  }, []);

  return {
    start,
    stop,
    stopAndGetBuffer,
    isRecording,
    getMimeType: () => mimeTypeRef.current || "audio/webm",
  };
}
