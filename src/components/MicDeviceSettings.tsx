import { useCallback, useEffect, useRef, useState } from "react";
import { MicIcon } from "./theme/icons";
import { PrimaryButton, Select } from "./theme/ui";
import { getRippleApi } from "../lib/rippleApi";

const BAR_COUNT = 20;
const SYSTEM_AUDIO_LABEL =
  /stereo mix|loopback|wave out|what u hear|system audio|virtual audio/i;

export function MicDeviceSettings() {
  const [granted, setGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopMonitoring = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setTesting(false);
    setLevel(0);
  }, []);

  const stopStream = useCallback(() => {
    stopMonitoring();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [stopMonitoring]);

  useEffect(() => () => stopStream(), [stopStream]);

  async function loadSavedDevice() {
    const res = await getRippleApi().micDevice.get().catch(() => ({
      ok: false as const,
    }));
    if (res.ok && res.deviceId) setDeviceId(res.deviceId);
  }

  async function refreshDevices(activeId?: string) {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
    setDevices(inputs);
    if (activeId) setDeviceId(activeId);
    else if (!deviceId && inputs[0]?.deviceId) setDeviceId(inputs[0].deviceId);
  }

  async function requestAccess() {
    setBusy(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setGranted(true);
      const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      await refreshDevices(activeId);
      await loadSavedDevice();
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't access the microphone. Check Windows Settings → Privacy → Microphone.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadSavedDevice();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        setGranted(true);
        await refreshDevices();
      } catch {
        setGranted(false);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectDevice(nextId: string) {
    setDeviceId(nextId);
    setError(null);
    const label = devices.find((d) => d.deviceId === nextId)?.label ?? nextId;
    if (SYSTEM_AUDIO_LABEL.test(label)) {
      setError(
        `"${label}" captures speaker/system audio, not your voice. Pick your headset or laptop mic instead.`,
      );
    }
    try {
      await getRippleApi().micDevice.set(nextId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save microphone");
    }
    if (!granted) return;
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { ideal: nextId } },
      });
      streamRef.current = stream;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Couldn't switch microphone.");
    }
  }

  function toggleTest() {
    if (testing) {
      stopMonitoring();
      return;
    }
    const stream = streamRef.current;
    if (!stream) {
      setError("Allow microphone access first, then test.");
      return;
    }
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setLevel(Math.min(1, rms * 5));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    setTesting(true);
  }

  const litBars = Math.round(level * BAR_COUNT);
  const selectedLabel =
    devices.find((d) => d.deviceId === deviceId)?.label ?? "Default";

  return (
    <div>
      <h3 className="text-sm font-medium uppercase tracking-wide text-onboard-subtle">
        Microphone
      </h3>
      <p className="mt-1 text-xs text-onboard-muted">
        Ripple was using Windows&apos; default mic — often the wrong device.
        Pick the mic you actually speak into and test the level bars.
      </p>
      {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
      {loading ? (
        <p className="mt-4 text-sm text-onboard-muted">Loading…</p>
      ) : !granted ? (
        <PrimaryButton className="mt-4" disabled={busy} onClick={() => void requestAccess()}>
          Allow microphone access
        </PrimaryButton>
      ) : (
        <>
          <label className="mb-2 mt-4 block text-sm font-medium text-onboard-ink">
            Input device
          </label>
          <Select
            value={deviceId}
            onChange={(e) => void selectDevice(e.target.value)}
            disabled={busy || devices.length === 0}
          >
            {devices.length === 0 ? (
              <option value="">No microphones found</option>
            ) : (
              devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))
            )}
          </Select>
          <p className="mt-2 text-xs text-onboard-muted">
            Active: {selectedLabel}
          </p>
          <div className="mt-4 flex h-8 items-end gap-0.5">
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <div
                key={i}
                className={`w-1.5 flex-1 rounded-sm transition-colors ${
                  i < litBars ? "bg-onboard-accent" : "bg-onboard-border"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={toggleTest}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-onboard-border bg-onboard-surface py-2.5 text-sm font-medium text-onboard-ink transition hover:bg-onboard-card-soft"
          >
            <MicIcon width={16} height={16} />
            {testing ? "Stop test — speak now" : "Test microphone"}
          </button>
        </>
      )}
    </div>
  );
}
