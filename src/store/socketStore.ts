import { create } from "zustand";
import { getRippleApi } from "../lib/rippleApi";

export interface ActionRunRecord {
  index: number;
  type: string;
  status: "executed" | "failed";
  error?: string;
  detail?: string;
}

export interface CommandDebugEntry {
  at: string;
  command: string;
  transcript?: string;
  intent?: string;
  tools?: string[];
  tool?: string;
  status: "SUCCESS" | "FAILED" | "CLARIFY" | "PARTIAL";
  result?: string;
  error?: string;
  source?: string;
}

interface SocketState {
  status: string;
  connected: boolean;
  lastTranscript: string | null;
  lastCommandPreview: string | null;
  lastExecution: ActionRunRecord[] | null;
  lastGeneratedText: string | null;
  lastError: string | null;
  lastDebug: CommandDebugEntry | null;
  debugLog: CommandDebugEntry[];
  hydrate: () => Promise<void>;
  bindEvents: () => () => void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  status: "disconnected",
  connected: false,
  lastTranscript: null,
  lastCommandPreview: null,
  lastExecution: null,
  lastGeneratedText: null,
  lastError: null,
  lastDebug: null,
  debugLog: [],

  hydrate: async () => {
    try {
      const res = await getRippleApi().getSocketStatus();
      set({
        status: res.status,
        connected: res.connected,
      });
    } catch {
      /* ignore */
    }
  },

  bindEvents: () => {
    const api = getRippleApi();
    const unsubs = [
      api.onIpcEvent("socket:status", (payload) => {
        const p = payload as { status: string; connected?: boolean };
        set({
          status: p.status,
          connected: p.connected ?? p.status === "connected",
        });
      }),
      api.onIpcEvent("voice:transcript", (payload) => {
        const p = payload as {
          success?: boolean;
          data?: { text?: string };
          message?: string;
        };
        if (p.success && p.data?.text) {
          set({ lastTranscript: p.data.text, lastError: null });
        } else if (p.message) {
          set({ lastError: p.message });
        }
      }),
      api.onIpcEvent("command:result", (payload) => {
        const p = payload as {
          success?: boolean;
          data?: { message?: string; intent?: string; result?: string };
          message?: string;
        };
        const preview =
          p.data?.result ??
          p.data?.message ??
          p.data?.intent ??
          (p.success ? "Command complete" : p.message);
        if (preview) {
          set({
            lastCommandPreview: String(preview).slice(0, 200),
            lastGeneratedText:
              typeof p.data?.result === "string" ? p.data.result : null,
            lastError: null,
          });
        }
      }),
      api.onIpcEvent("command:debug", (payload) => {
        const p = payload as CommandDebugEntry;
        if (!p?.command) return;
        set((state) => {
          const entry: CommandDebugEntry = {
            at: p.at || new Date().toISOString(),
            command: p.command,
            transcript: p.transcript,
            intent: p.intent,
            tools: p.tools,
            tool: p.tool,
            status: p.status,
            result: p.result,
            error: p.error,
            source: p.source,
          };
          return {
            lastDebug: entry,
            debugLog: [entry, ...state.debugLog].slice(0, 12),
            lastCommandPreview: `${entry.status}: ${entry.tool ?? entry.intent ?? "—"}`,
            lastGeneratedText: entry.result ?? null,
            lastError: entry.error ?? null,
          };
        });
      }),
      api.onIpcEvent("actions:executed", (payload) => {
        const p = payload as {
          records?: ActionRunRecord[];
          result?: string;
          intent?: string;
        };
        if (p.records?.length) {
          set({ lastExecution: p.records });
        }
        if (p.result) {
          set({ lastGeneratedText: p.result });
        }
      }),
      api.onIpcEvent("socket:error", (payload) => {
        const p = payload as { message?: string };
        if (p.message) set({ lastError: p.message });
      }),
    ];

    if (!get().connected) {
      void get().hydrate();
    }

    return () => unsubs.forEach((u) => u());
  },
}));
