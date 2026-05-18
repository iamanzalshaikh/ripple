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

export function useVoiceCapture() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mimeTypeRef = useRef("audio/webm");

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (onChunk: (chunk: ArrayBuffer) => void): Promise<void> => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      mimeTypeRef.current = pickMimeType();

      const recorder = new MediaRecorder(
        stream,
        mimeTypeRef.current ? { mimeType: mimeTypeRef.current } : undefined,
      );
      recorderRef.current = recorder;

      recorder.ondataavailable = async (ev) => {
        if (!ev.data.size) return;
        const buf = await ev.data.arrayBuffer();
        onChunk(buf);
      };

      recorder.start(CHUNK_MS);
    },
    [],
  );

  const stop = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      stopTracks();
      return;
    }

    await new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

    recorderRef.current = null;
    stopTracks();
  }, [stopTracks]);

  const isRecording = useCallback(() => {
    const r = recorderRef.current;
    return Boolean(r && r.state === "recording");
  }, []);

  return {
    start,
    stop,
    isRecording,
    getMimeType: () => mimeTypeRef.current || "audio/webm",
  };
}
