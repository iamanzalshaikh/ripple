/**
 * Live API helpers — signup token + Whisper transcribe for E2E.
 */
import { readFileSync } from "node:fs";
import { File } from "node:buffer";
import { join } from "node:path";

export const API_BASE =
  process.env.VITE_API_URL ?? "http://127.0.0.1:3007/api/v1";

export const LIVE_ENABLED = process.env.RUN_LIVE_TESTS === "1";

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5_000);
    const res = await fetch(`${API_BASE}/health`, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export async function resolveLiveToken(): Promise<string> {
  const fromEnv = process.env.RIPPLE_TEST_TOKEN?.trim();
  if (fromEnv && (await tokenWorks(fromEnv))) return fromEnv;
  if (fromEnv) {
    console.warn("[live-e2e] RIPPLE_TEST_TOKEN invalid — trying email login");
  }

  const email = process.env.RIPPLE_TEST_EMAIL?.trim();
  const password = process.env.RIPPLE_TEST_PASSWORD?.trim();
  if (email && password) {
    const login = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (login.ok) {
      const body = (await login.json()) as { data?: { token?: string } };
      if (body.data?.token) return body.data.token;
    }
    throw new Error(
      `Login failed (${login.status}). Check RIPPLE_TEST_EMAIL / RIPPLE_TEST_PASSWORD in ripple-desktop/.env`,
    );
  }

  throw new Error(
    "Missing live test auth. Set RIPPLE_TEST_TOKEN in ripple-desktop/.env " +
      "(or RIPPLE_TEST_EMAIL + RIPPLE_TEST_PASSWORD). Run: npm run test:fetch-token",
  );
}

async function tokenWorks(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function transcribeWavFile(
  token: string,
  wavPath: string,
): Promise<string> {
  const buffer = readFileSync(wavPath);
  const form = new FormData();
  form.append(
    "audio",
    new File([buffer], "sample.wav", { type: "audio/wav" }),
  );

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  const res = await fetch(`${API_BASE}/voice/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: ac.signal,
  });
  clearTimeout(t);

  if (res.status === 501) {
    throw new Error("OPENAI_API_KEY not set on backend");
  }
  if (!res.ok) {
    throw new Error(`transcribe ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as {
    success?: boolean;
    data?: { text?: string };
  };
  const text = body.data?.text?.trim();
  if (!text) throw new Error("transcribe returned empty text");
  return text;
}

export type LiveWhisperCase = {
  fixture: string;
  spoken: string;
  route: "desktop" | "whatsapp" | "youtube" | "none";
  kind?: string;
  /** Whisper output must include these (case-insensitive). */
  heardIncludes?: string[];
  /** Accept any of these kinds when STT wording varies. */
  kinds?: string[];
};

export const LIVE_WHISPER_CASES: LiveWhisperCase[] = [
  {
    fixture: "download-kholo.wav",
    spoken: "Download kholo",
    route: "desktop",
    kind: "folder",
    heardIncludes: ["download"],
    kinds: ["folder", "open_alias"],
  },
  {
    fixture: "open-downloads.wav",
    spoken: "Open downloads",
    route: "desktop",
    kind: "folder",
    heardIncludes: ["download"],
    kinds: ["folder", "open_alias"],
  },
  {
    fixture: "mera-resume.wav",
    spoken: "Mera resume kholo",
    route: "desktop",
    kind: "smart_search",
    heardIncludes: ["resume"],
    kinds: ["smart_search"],
  },
  {
    fixture: "open-calculator.wav",
    spoken: "Open calculator",
    route: "desktop",
    kind: "launch_app",
    heardIncludes: ["calcul"],
    kinds: ["launch_app"],
  },
  {
    fixture: "open-it-again.wav",
    spoken: "Open it again",
    route: "desktop",
    kind: "recall_memory",
    heardIncludes: ["again"],
    kinds: ["recall_memory"],
  },
  {
    fixture: "open-whatsapp.wav",
    spoken: "Open WhatsApp",
    route: "whatsapp",
    kind: "workflow",
    heardIncludes: ["whats"],
    kinds: ["workflow"],
  },
  {
    fixture: "message-noor.wav",
    spoken: "Message Noor hello",
    route: "whatsapp",
    kind: "workflow",
    heardIncludes: ["hello", "mess"],
    kinds: ["workflow"],
  },
  {
    fixture: "open-youtube.wav",
    spoken: "Open YouTube",
    route: "desktop",
    kind: "open_workspace",
    heardIncludes: ["you"],
    kinds: ["open_workspace"],
  },
];

export function fixturePath(name: string): string {
  return join(
    process.cwd(),
    "electron/automation/voice/nlu/__tests__/fixtures/whisper",
    name,
  );
}
