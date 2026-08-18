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
  flushVoice: (args: {
    streamId: string;
    sessionId?: string;
    language?: string;
  }) => Promise<{ ok: boolean; message?: string; data?: unknown }>;
  endVoice: (args: {
    streamId: string;
    sessionId?: string;
    language?: string;
  }) => Promise<{ ok: boolean; message?: string; data?: unknown }>;
  cancelVoice: (streamId: string) => Promise<{ ok: boolean; message?: string }>;
  streaming: {
    begin: (streamId: string) => Promise<{ ok: boolean; message?: string }>;
    clear: () => Promise<{ ok: boolean }>;
  };
  executeCommand: (args: {
    command: string;
    sessionId?: string;
    contextMetadata?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; message?: string; data?: unknown }>;
  executeDictation: (args: {
    text: string;
    insert?: boolean;
    requestedLanguage?: string;
    detectedLanguage?: string;
  }) => Promise<{
    ok: boolean;
    mode: "dictation";
    finalText?: string;
    inserted?: boolean;
    error?: string;
    correctionKind?: string;
    session?: {
      sessionId: number;
      utteranceCount: number;
      elapsedMs: number;
      remainingMs: number;
      windowMs: number;
    };
    transform?: boolean;
    originalText?: string;
  }>;
  getDictationSessionStatus: () => Promise<{
    ok: boolean;
    session: {
      sessionId: number;
      utteranceCount: number;
      elapsedMs: number;
      remainingMs: number;
      windowMs: number;
    } | null;
  }>;
  language: {
    get: () => Promise<{ ok: boolean; language?: string; message?: string }>;
    set: (language: string) => Promise<{ ok: boolean; language?: string; message?: string }>;
  };
  loopback?: {
    enable: () => Promise<void>;
    disable: () => Promise<void>;
  };
  quietMode: {
    get: () => Promise<{ ok: boolean; quietMode?: boolean; message?: string }>;
    set: (enabled: boolean) => Promise<{ ok: boolean; quietMode?: boolean; message?: string }>;
  };
  micDevice: {
    get: () => Promise<{ ok: boolean; deviceId?: string; message?: string }>;
    set: (deviceId: string) => Promise<{ ok: boolean; deviceId?: string; message?: string }>;
  };
  pipeline: {
    get: () => Promise<{
      ok: boolean;
      level?: string;
      layers?: { transcribe: true; cleanup: boolean; format: boolean; context: boolean };
      message?: string;
    }>;
    set: (args: {
      level?: string;
      cleanup?: boolean;
      format?: boolean;
      context?: boolean;
    }) => Promise<{
      ok: boolean;
      level?: string;
      layers?: { transcribe: true; cleanup: boolean; format: boolean; context: boolean };
      message?: string;
    }>;
  };
  dictionary: {
    list: () => Promise<{
      ok: boolean;
      message?: string;
      items?: Array<{
        spokenForm: string;
        canonicalForm: string;
        source: string;
        updatedAt: string;
      }>;
    }>;
    add: (args: {
      spokenForm: string;
      canonicalForm: string;
    }) => Promise<{
      ok: boolean;
      message?: string;
      entry?: {
        spokenForm: string;
        canonicalForm: string;
        source: string;
        updatedAt: string;
      };
    }>;
    remove: (spokenForm: string) => Promise<{ ok: boolean; message?: string }>;
  };
  snippets: {
    list: () => Promise<{
      ok: boolean;
      message?: string;
      items?: Array<{
        trigger: string;
        expansion: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    add: (args: {
      trigger: string;
      expansion: string;
    }) => Promise<{
      ok: boolean;
      message?: string;
      entry?: {
        trigger: string;
        expansion: string;
        createdAt: string;
        updatedAt: string;
      };
    }>;
    remove: (trigger: string) => Promise<{ ok: boolean; message?: string }>;
  };
  styles: {
    list: () => Promise<{
      ok: boolean;
      message?: string;
      items?: Array<{
        processName: string;
        tone:
          | "very_casual"
          | "casual"
          | "neutral"
          | "professional"
          | "formal";
        updatedAt: string;
      }>;
    }>;
    set: (args: {
      processName: string;
      tone:
        | "very_casual"
        | "casual"
        | "neutral"
        | "professional"
        | "formal";
    }) => Promise<{
      ok: boolean;
      message?: string;
      entry?: {
        processName: string;
        tone:
          | "very_casual"
          | "casual"
          | "neutral"
          | "professional"
          | "formal";
        updatedAt: string;
      };
    }>;
    remove: (processName: string) => Promise<{ ok: boolean; message?: string }>;
  };
  notes: {
    list: () => Promise<{
      ok: boolean;
      message?: string;
      items?: Array<{
        id: string;
        title: string;
        body: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>;
    create: (args?: { title?: string; body?: string }) => Promise<{
      ok: boolean;
      message?: string;
      note?: { id: string; title: string; body: string; createdAt: string; updatedAt: string };
    }>;
    update: (args: { id: string; title?: string; body?: string }) => Promise<{
      ok: boolean;
      message?: string;
      note?: { id: string; title: string; body: string; createdAt: string; updatedAt: string };
    }>;
    delete: (id: string) => Promise<{ ok: boolean; message?: string }>;
    setActiveNote: (id: string | null) => Promise<{ ok: boolean }>;
  };
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
  getP85Dashboard: () => Promise<{
    ok: boolean;
    message?: string;
    dashboard?: {
      session: {
        total: number;
        execute: number;
        defer: number;
        clarify: number;
        l0Hits: number;
        gptHits: number;
        avgLatencyMs: number;
        fallbackPct: number;
      };
      persisted: {
        total: number;
        execute: number;
        defer: number;
        clarify: number;
        l0Hits: number;
        gptHits: number;
        cacheHits: number;
        avgLatencyMs: number;
        l0HitRatePct: number;
        gptFallbackPct: number;
        topDeferReasons: Array<{ reason: string; count: number }>;
        topTools: Array<{ tool: string; count: number }>;
      };
      routerParity: {
        p85Executes: number;
        mismatchTotal: number;
        byLegacyRouter: Record<string, number>;
        recentMismatches: Array<{
          legacyRouter: string;
          p85Reason: string;
          command: string;
          at: number;
        }>;
        readyForDeprecation: boolean;
      };
      cacheEntries: number;
      recentObservations?: Array<{
        command: string;
        planSource: string;
        goal: string;
        tools: string[];
        intent?: string;
        succeeded: boolean;
        recovered: boolean;
        recoveryAttempts: number;
        failureClass?: string;
        actionCount: number;
        failedActions: string[];
        at: number;
      }>;
    };
  }>;
  exportPlannerShadowCsv: () => Promise<{
    ok: boolean;
    message?: string;
    csv?: string;
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
  expandLanguageMenu: (itemCount: number) => Promise<{ ok: boolean }>;
  collapseToIndicator: () => Promise<{ ok: boolean }>;
  flowBar: {
    openScratchpad: () => Promise<{ ok: boolean; message?: string }>;
    startTransform: () => Promise<{ ok: boolean; message?: string }>;
  };
  meeting: {
    getState: () => Promise<{
      ok: boolean;
      message?: string;
      state?: {
        state: "idle" | "recording" | "stopping";
        meetingId: string | null;
        noteId: string | null;
        startedAt: number | null;
        elapsedMs: number;
        lastTranscriptSnippet: string | null;
        transcriptLength: number;
        error: string | null;
        failedChunks?: number;
      };
    }>;
    toggle: () => Promise<{ ok: boolean; message?: string }>;
    stop: () => Promise<{ ok: boolean; message?: string }>;
    acceptConsent: () => Promise<{ ok: boolean; message?: string }>;
    declineConsent: () => Promise<{ ok: boolean; message?: string }>;
    sendChunk: (args: {
      chunk: Uint8Array;
      mimeType?: string;
      filename?: string;
    }) => Promise<{ ok: boolean; text?: string; message?: string }>;
    end: (args?: {
      chunk?: Uint8Array;
      mimeType?: string;
      filename?: string;
    }) => Promise<{ ok: boolean; message?: string }>;
  };
  onIpcEvent: (
    channel: string,
    cb: (payload: unknown) => void,
  ) => () => void;
  onOverlayState: (cb: (state: string) => void) => () => void;
  onVoiceToggle: (
    cb: (payload: {
      action: "start" | "stop" | "cancel";
      mode?: "command" | "dictation" | "transform";
    }) => void,
  ) => () => void;
  onMeetingToggle?: (
    cb: (payload: { action: "start" | "stop" }) => void,
  ) => () => void;
  onMeetingConsent?: (
    cb: (payload: { show: boolean }) => void,
  ) => () => void;
  onMeetingState?: (
    cb: (payload: {
      state: "idle" | "recording" | "stopping";
      meetingId: string | null;
      noteId: string | null;
      startedAt: number | null;
      elapsedMs: number;
      lastTranscriptSnippet: string | null;
      transcriptLength: number;
      error: string | null;
      failedChunks?: number;
    }) => void,
  ) => () => void;
  pickDisambiguation?: (path: string | null) => Promise<{ ok: boolean }>;
  onDisambiguationShow?: (
    cb: (payload: {
      spoken: string;
      items: Array<{ path: string; label: string }>;
    }) => void,
  ) => () => void;
  onDisambiguationHide?: (cb: () => void) => () => void;
  onClarifyQuestion?: (
    cb: (payload: { question: string }) => void,
  ) => () => void;
  onCodeRepairShow?: (
    cb: (payload: {
      file: string;
      fileName: string;
      line: number;
      code: string;
      message: string;
      why: string;
      suggestedFix: string;
      before?: string;
      after?: string;
      hasSafePatch: boolean;
      projectRoot: string;
    }) => void,
  ) => () => void;
  onCodeRepairHide?: (cb: () => void) => () => void;
  codeRepairAction?: (
    action: "open" | "apply" | "ignore",
  ) => Promise<{ ok: boolean; error?: string }>;
  isOverlay: () => boolean;
}

interface Window {
  ripple: RippleApi;
}
