import { useCallback, useRef } from "react";

const CHUNK_MS = 300;

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

export function useVoiceCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partsRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef("audio/webm");

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<void> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    partsRef.current = [];

    const preferred = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      preferred ? { mimeType: preferred } : undefined,
    );
    recorderRef.current = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) partsRef.current.push(ev.data);
    };

    recorder.start(CHUNK_MS);
    mimeTypeRef.current = recorder.mimeType || preferred || "audio/webm";
  }, []);

  const stopAndGetBuffer = useCallback(async (): Promise<VoiceRecordingResult> => {
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

    const mimeType = mimeTypeRef.current || recorder.mimeType || "audio/webm";
    const blob = new Blob(partsRef.current, { type: mimeType });
    partsRef.current = [];

    if (!blob.size) {
      throw new Error("No audio captured");
    }

    return {
      buffer: await blob.arrayBuffer(),
      mimeType,
      filename: filenameForMime(mimeType),
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
};
