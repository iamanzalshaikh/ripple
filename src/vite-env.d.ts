/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_SOCKET_URL?: string;
}

interface RippleUser {
  id: string;
  email: string;
  onboarding_completed: boolean;
}

interface AuthResult {
  ok: boolean;
  message?: string;
  user?: RippleUser;
  sessionId?: string;
}

interface SocketStatusPayload {
  status: string;
  connected: boolean;
  attempt?: number;
  retryInMs?: number;
}

interface VoiceTranscriptPayload {
  success: boolean;
  data?: {
    stream_id: string;
    session_id?: string;
    text: string;
    is_final?: boolean;
  };
  message?: string;
}

interface CommandResultPayload {
  success: boolean;
  data?: {
    command_id?: string;
    intent?: string;
    actions?: unknown[];
    message?: string;
  };
  message?: string;
}

interface RippleApi {
  login: (email: string, password: string) => Promise<AuthResult>;
  signup: (
    email: string,
    password: string,
    name?: string,
  ) => Promise<AuthResult>;
  logout: () => Promise<{ ok: boolean }>;
  getSession: () => Promise<{
    loggedIn: boolean;
    user?: RippleUser;
    sessionId?: string;
  }>;
  checkApiHealth: () => Promise<{
    ok: boolean;
    url: string;
    status?: number;
    message: string;
    latencyMs?: number;
  }>;
  getSocketStatus: () => Promise<{
    status: string;
    connected: boolean;
    sessionId: string | null;
  }>;
  sendVoiceChunk: (args: {
    streamId: string;
    sessionId?: string;
    chunk: Uint8Array;
    mimeType?: string;
  }) => Promise<{ ok: boolean; message?: string; data?: unknown }>;
  endVoice: (args: {
    streamId: string;
    sessionId?: string;
  }) => Promise<{ ok: boolean; message?: string; data?: unknown }>;
  cancelVoice: (streamId: string) => Promise<{ ok: boolean; message?: string }>;
  executeCommand: (args: {
    command: string;
    sessionId?: string;
    contextMetadata?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; message?: string; data?: unknown }>;
  getCommandHistory: (args?: {
    page?: number;
    limit?: number;
    intent?: string;
    context_type?: string;
    action_source?: string;
  }) => Promise<{
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
  }>;
  setOverlayVoiceActive: (active: boolean) => Promise<{ ok: boolean }>;
  onIpcEvent: (
    channel: string,
    cb: (payload: unknown) => void,
  ) => () => void;
  onOverlayState: (cb: (state: string) => void) => () => void;
  onVoiceToggle: (
    cb: (payload: { action: "start" | "stop" | "cancel" }) => void,
  ) => () => void;
  isOverlay: () => boolean;
}

interface Window {
  ripple: RippleApi;
}
