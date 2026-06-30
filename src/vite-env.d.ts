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
  runPreflightHealth: () => Promise<{
    ok: boolean;
    ready: boolean;
    checks: Array<{ id: string; ok: boolean; detail: string }>;
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
    filename?: string;
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
  getTelemetrySummary: () => Promise<{
    ok: boolean;
    message?: string;
    summary?: {
      total: number;
      byOutcome: Record<string, number>;
      byPlannerSource: Record<string, number>;
      recentFailures: Array<{
        command: string;
        outcome?: string;
        planner_source?: string;
        detail?: string;
        at: number;
      }>;
      successRatePercent: number;
      rolling7DaySuccessRate: number;
      topFailedCommands: Array<{ command: string; count: number }>;
      topClarifications: Array<{ command: string; count: number }>;
      topSearchMisses: Array<{ command: string; count: number }>;
      plannerMix: { offline: number; gpt: number; fast: number; graph: number };
      blockedPermissionCount: number;
      topWorkflows: Array<{ name: string; version: number; runCount: number }>;
      topApps: Array<{ appId: string; openCount: number; score: number }>;
      avgLatencyMs: number;
    };
  }>;
  exportTelemetryCsv: () => Promise<{
    ok: boolean;
    message?: string;
    csv?: string;
  }>;
  getCiGateStatus: () => Promise<{
    ok: boolean;
    message?: string;
    gate?: {
      passed: number;
      total: number;
      passRatePercent: number;
      thresholdPercent: number;
      meetsGate: boolean;
      failures: string[];
    };
  }>;
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
  pickDisambiguation?: (path: string | null) => Promise<{ ok: boolean }>;
  onDisambiguationShow?: (
    cb: (payload: {
      spoken: string;
      items: Array<{ path: string; label: string }>;
    }) => void,
  ) => () => void;
  onDisambiguationHide?: (cb: () => void) => () => void;
  isOverlay: () => boolean;
}

interface Window {
  ripple: RippleApi;
}
