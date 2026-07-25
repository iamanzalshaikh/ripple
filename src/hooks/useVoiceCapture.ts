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

export interface VoiceCaptureStartOptions {
  /** P9.6 — boost + de-noise-suppress for soft/whispered speech. */
  quiet?: boolean;
  /**
   * P7.8 — called for each MediaRecorder timeslice while recording so the
   * client can upload chunks for mid-utterance `voice:flush` partials.
   */
  onChunk?: (chunk: ArrayBuffer, mimeType: string) => void;
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

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // The recorded stream is a synthetic WebAudio destination in quiet mode —
    // stopping its tracks doesn't release the physical mic, so stop that too.
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  }, []);

  const start = useCallback(
    async (options?: VoiceCaptureStartOptions): Promise<void> => {
      const quiet = options?.quiet === true;
      onChunkRef.current = options?.onChunk;
      streamedChunksRef.current = false;
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: quiet
          ? {
              // Noise suppression / echo cancellation are tuned around normal
              // speech + background noise; on breathy, low-amplitude whisper
              // audio they frequently misclassify the voice itself as noise
              // and attenuate it. Auto gain control alone is kept on and
              // supplemented with an explicit software boost below.
              autoGainControl: true,
              noiseSuppression: false,
              echoCancellation: false,
            }
          : true,
      });
      micStreamRef.current = micStream;
      partsRef.current = [];

      let recordStream = micStream;
      if (quiet) {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioContext = new AudioCtx();
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(micStream);
        const gain = audioContext.createGain();
        gain.gain.value = QUIET_MODE_GAIN;
        const destination = audioContext.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(destination);
        recordStream = destination.stream;
      }
      streamRef.current = recordStream;

      const preferred = pickMimeType();
      const recorder = new MediaRecorder(
        recordStream,
        preferred ? { mimeType: preferred } : undefined,
      );
      recorderRef.current = recorder;

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
    },
    [],
  );

  const stopAndGetBuffer = useCallback(async (): Promise<
    VoiceRecordingResult & { alreadyStreamed: boolean }
  > => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      stopTracks();
      partsRef.current = [];
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
    stopTracks();
    onChunkRef.current = undefined;

    const mimeType = mimeTypeRef.current || recorder.mimeType || "audio/webm";
    const blob = new Blob(partsRef.current, { type: mimeType });
    const alreadyStreamed = streamedChunksRef.current;
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
  }, [stopTracks]);

  const stop = useCallback(async (): Promise<void> => {
    try {
      await stopAndGetBuffer();
    } catch {
      /* discard */
    }
  }, [stopAndGetBuffer]);

  const isRecording = useCallback(() => {
    const r = recorderRef.current;
    return Boolean(r && r.state === "recording");
  }, []);

  return {
    start,
    stop,
    stopAndGetBuffer,
    isRecording,
    getMimeType: () => mimeTypeRef.current || "audio/webm",
  };
}
