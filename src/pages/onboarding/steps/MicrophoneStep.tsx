import { useEffect, useRef, useState } from "react";
import { ArrowExternalIcon, LockIcon, MicIcon, MicOffIcon } from "../../../components/theme/icons";
import { Card, Divider, GhostLink, PrimaryButton, Select, StepBadge } from "../../../components/theme/ui";
import { getRippleApi } from "../../../lib/rippleApi";

interface Props {
  totalSteps: number;
  onContinue: () => void;
  onSkip: () => void;
}

const BAR_COUNT = 24;

export function MicrophoneStep({ totalSteps, onContinue, onSkip }: Props) {
  const [granted, setGranted] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0); // 0..1
  const [levelDb, setLevelDb] = useState(-60);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopMonitoring();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopMonitoring() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setTesting(false);
    setLevel(0);
    setLevelDb(-60);
  }

  async function requestAccess() {
    setRequesting(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setGranted(true);

      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "audioinput",
      );
      setDevices(inputs);
      const activeId = stream.getAudioTracks()[0]?.getSettings().deviceId;
      if (activeId) setDeviceId(activeId);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't access the microphone. Check OS permissions and try again.",
      );
    } finally {
      setRequesting(false);
    }
  }

  async function switchDevice(nextId: string) {
    setDeviceId(nextId);
    if (!granted) return;
    stopMonitoring();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: nextId } },
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
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
    if (!stream) return;

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
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
      const db = rms > 0 ? 20 * Math.log10(rms) : -60;
      setLevelDb(Math.max(-60, Math.round(db)));
      setLevel(Math.min(1, rms * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    setTesting(true);
  }

  async function handleContinue() {
    if (deviceId) {
      await getRippleApi().micDevice.set(deviceId).catch(() => undefined);
    }
    onContinue();
  }

  const litBars = Math.round(level * BAR_COUNT);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <StepBadge step={2} total={totalSteps} label="Microphone" />
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-onboard-ink">
          Let's check your microphone.
        </h1>
        <p className="mt-2 text-base text-onboard-muted">
          Ripple works best with a clear audio signal. This takes about 30
          seconds.
        </p>

        <Divider />

        <div className="rounded-xl border border-onboard-border bg-onboard-surface p-6">
          {granted ? (
            <div className="flex items-center gap-3 text-onboard-ink">
              <MicIcon className="text-onboard-success" />
              <p className="text-sm">
                Microphone access granted. You're all set to continue.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 text-onboard-ink">
                <MicOffIcon className="text-onboard-subtle" />
                <p className="text-sm">
                  Ripple needs microphone access to work. Click below to allow
                  it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void requestAccess()}
                disabled={requesting}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-onboard-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-onboard-accent-hover disabled:opacity-60"
              >
                <LockIcon />
                {requesting ? "Requesting…" : "Allow Microphone Access"}
              </button>
              {error ? (
                <p className="mt-3 text-sm text-red-500">{error}</p>
              ) : null}
              <button
                type="button"
                className="mt-4 flex items-center gap-1.5 text-sm text-onboard-accent-hover hover:underline"
              >
                How to allow access on macOS / Windows / Linux
                <ArrowExternalIcon />
              </button>
            </>
          )}
        </div>

        <div className="mt-6">
          <label className="mb-2 block text-sm font-medium text-onboard-ink">
            Input Device
          </label>
          <Select
            value={deviceId}
            onChange={(e) => void switchDevice(e.target.value)}
            disabled={!granted}
          >
            {devices.length === 0 ? (
              <option value="">Select your microphone</option>
            ) : (
              devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))
            )}
          </Select>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-onboard-ink">Input Level</span>
            <span className="text-onboard-muted">{levelDb}dB</span>
          </div>
          <div className="flex h-3 items-center gap-1">
            {Array.from({ length: BAR_COUNT }).map((_, i) => (
              <span
                key={i}
                className={`h-full flex-1 rounded-sm transition-colors ${
                  testing && i < litBars
                    ? "bg-onboard-accent"
                    : "bg-onboard-border"
                }`}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={toggleTest}
          disabled={!granted}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-onboard-border bg-onboard-surface py-3 text-sm font-medium text-onboard-ink transition hover:bg-onboard-card-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MicIcon width={18} height={18} />
          {testing ? "Stop Test" : "Test My Microphone"}
        </button>

        <Divider />

        <div className="flex items-center justify-between">
          <GhostLink onClick={onSkip}>
            Skip this step — I'll set up my mic later
          </GhostLink>
          <PrimaryButton withArrow onClick={() => void handleContinue()}>
            Continue
          </PrimaryButton>
        </div>
        <button
          type="button"
          className="mt-3 flex items-center gap-1.5 text-sm text-onboard-muted hover:text-onboard-ink"
        >
          Need help choosing a microphone?
          <ArrowExternalIcon />
        </button>
      </Card>
    </div>
  );
}
