import { contextBridge, ipcRenderer } from "electron";

export interface RippleUser {
  id: string;
  email: string;
  onboarding_completed: boolean;
}

type Unsubscribe = () => void;

const api = {
  login: (email: string, password: string) =>
    ipcRenderer.invoke("auth:login", { email, password }),
  signup: (email: string, password: string, name?: string) =>
    ipcRenderer.invoke("auth:signup", { email, password, name }),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getSession: () =>
    ipcRenderer.invoke("auth:session") as Promise<{
      loggedIn: boolean;
      user?: RippleUser;
      sessionId?: string;
    }>,
  checkApiHealth: () =>
    ipcRenderer.invoke("api:health") as Promise<{
      ok: boolean;
      url: string;
      status?: number;
      message: string;
      latencyMs?: number;
    }>,
  getSocketStatus: () =>
    ipcRenderer.invoke("socket:status") as Promise<{
      status: string;
      connected: boolean;
      sessionId: string | null;
    }>,
  sendVoiceChunk: (args: {
    streamId: string;
    sessionId?: string;
    chunk: Uint8Array;
    mimeType?: string;
    filename?: string;
  }) => ipcRenderer.invoke("voice:chunk", args),
  endVoice: (args: { streamId: string; sessionId?: string }) =>
    ipcRenderer.invoke("voice:end", args),
  cancelVoice: (streamId: string) =>
    ipcRenderer.invoke("voice:cancel", { streamId }),
  executeCommand: (args: {
    command: string;
    sessionId?: string;
    contextMetadata?: Record<string, unknown>;
  }) => ipcRenderer.invoke("command:execute", args),
  getCommandHistory: (args?: {
    page?: number;
    limit?: number;
    intent?: string;
    context_type?: string;
    action_source?: string;
  }) =>
    ipcRenderer.invoke("history:list", args ?? {}) as Promise<{
      ok: boolean;
      message?: string;
      items?: Array<{
        id: string;
        command: string;
        intent: string;
        result: string | null;
        output_type: string;
        confidence: number;
        context_type: string | null;
        action_source: string | null;
        created_at: string;
      }>;
      total?: number;
      page?: number;
      limit?: number;
    }>,
  setOverlayVoiceActive: (active: boolean) =>
    ipcRenderer.invoke("overlay:voice-active", active),
  onIpcEvent: (channel: string, cb: (payload: unknown) => void): Unsubscribe => {
    const handler = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  onOverlayState: (cb: (state: string) => void): Unsubscribe => {
    const handler = (_: unknown, state: string) => cb(state);
    ipcRenderer.on("overlay:state", handler);
    return () => ipcRenderer.removeListener("overlay:state", handler);
  },
  onVoiceToggle: (
    cb: (payload: { action: "start" | "stop" | "cancel" }) => void,
  ): Unsubscribe => {
    const handler = (
      _: unknown,
      payload: { action: "start" | "stop" | "cancel" },
    ) => cb(payload);
    ipcRenderer.on("overlay:voice-toggle", handler);
    return () => ipcRenderer.removeListener("overlay:voice-toggle", handler);
  },
  isOverlay: () =>
    new URLSearchParams(window.location.search).get("overlay") === "1",
};

contextBridge.exposeInMainWorld("ripple", api);

export type RippleApi = typeof api;
