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
  runPreflightHealth: () =>
    ipcRenderer.invoke("preflight:health") as Promise<{
      ok: boolean;
      ready: boolean;
      checks: Array<{ id: string; ok: boolean; detail: string }>;
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
  flushVoice: (args: {
    streamId: string;
    sessionId?: string;
    language?: string;
  }) => ipcRenderer.invoke("voice:flush", args),
  endVoice: (args: { streamId: string; sessionId?: string; language?: string }) =>
    ipcRenderer.invoke("voice:end", args),
  cancelVoice: (streamId: string) =>
    ipcRenderer.invoke("voice:cancel", { streamId }),
  streaming: {
    begin: (streamId: string) =>
      ipcRenderer.invoke("streaming:begin", { streamId }) as Promise<{
        ok: boolean;
        message?: string;
      }>,
    clear: () =>
      ipcRenderer.invoke("streaming:clear") as Promise<{ ok: boolean }>,
  },
  executeCommand: (args: {
    command: string;
    sessionId?: string;
    contextMetadata?: Record<string, unknown>;
  }) => ipcRenderer.invoke("command:execute", args),
  executeDictation: (args: {
    text: string;
    insert?: boolean;
    requestedLanguage?: string;
    detectedLanguage?: string;
  }) =>
    ipcRenderer.invoke("dictation:execute", args) as Promise<{
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
    }>,
  getDictationSessionStatus: () =>
    ipcRenderer.invoke("dictation:sessionStatus") as Promise<{
      ok: boolean;
      session: {
        sessionId: number;
        utteranceCount: number;
        elapsedMs: number;
        remainingMs: number;
        windowMs: number;
      } | null;
    }>,
  getTelemetrySummary: () =>
    ipcRenderer.invoke("telemetry:summary") as Promise<{
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
    }>,
  exportTelemetryCsv: () =>
    ipcRenderer.invoke("telemetry:export") as Promise<{
      ok: boolean;
      message?: string;
      csv?: string;
    }>,
  getCiGateStatus: () =>
    ipcRenderer.invoke("telemetry:gate") as Promise<{
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
    }>,
  getP85Dashboard: () =>
    ipcRenderer.invoke("telemetry:p85") as Promise<{
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
    }>,
  exportPlannerShadowCsv: () =>
    ipcRenderer.invoke("telemetry:p85:export") as Promise<{
      ok: boolean;
      message?: string;
      csv?: string;
    }>,
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
  expandLanguageMenu: (itemCount: number) =>
    ipcRenderer.invoke("overlay:expandLanguageMenu", itemCount) as Promise<{
      ok: boolean;
    }>,
  collapseToIndicator: () =>
    ipcRenderer.invoke("overlay:collapseToIndicator") as Promise<{ ok: boolean }>,
  flowBar: {
    openScratchpad: () =>
      ipcRenderer.invoke("flowBar:openScratchpad") as Promise<{
        ok: boolean;
        message?: string;
      }>,
    startTransform: () =>
      ipcRenderer.invoke("flowBar:startTransform") as Promise<{
        ok: boolean;
        message?: string;
      }>,
  },
  language: {
    get: () =>
      ipcRenderer.invoke("language:get") as Promise<{
        ok: boolean;
        language?: string;
        message?: string;
      }>,
    set: (language: string) =>
      ipcRenderer.invoke("language:set", { language }) as Promise<{
        ok: boolean;
        language?: string;
        message?: string;
      }>,
  },
  quietMode: {
    get: () =>
      ipcRenderer.invoke("quietMode:get") as Promise<{
        ok: boolean;
        quietMode?: boolean;
        message?: string;
      }>,
    set: (enabled: boolean) =>
      ipcRenderer.invoke("quietMode:set", { enabled }) as Promise<{
        ok: boolean;
        quietMode?: boolean;
        message?: string;
      }>,
  },
  dictionary: {
    list: () =>
      ipcRenderer.invoke("dictionary:list") as Promise<{
        ok: boolean;
        message?: string;
        items?: Array<{
          spokenForm: string;
          canonicalForm: string;
          source: string;
          updatedAt: string;
        }>;
      }>,
    add: (args: { spokenForm: string; canonicalForm: string }) =>
      ipcRenderer.invoke("dictionary:add", args) as Promise<{
        ok: boolean;
        message?: string;
        entry?: {
          spokenForm: string;
          canonicalForm: string;
          source: string;
          updatedAt: string;
        };
      }>,
    remove: (spokenForm: string) =>
      ipcRenderer.invoke("dictionary:remove", { spokenForm }) as Promise<{
        ok: boolean;
        message?: string;
      }>,
  },
  snippets: {
    list: () =>
      ipcRenderer.invoke("snippets:list") as Promise<{
        ok: boolean;
        message?: string;
        items?: Array<{
          trigger: string;
          expansion: string;
          createdAt: string;
          updatedAt: string;
        }>;
      }>,
    add: (args: { trigger: string; expansion: string }) =>
      ipcRenderer.invoke("snippets:add", args) as Promise<{
        ok: boolean;
        message?: string;
        entry?: {
          trigger: string;
          expansion: string;
          createdAt: string;
          updatedAt: string;
        };
      }>,
    remove: (trigger: string) =>
      ipcRenderer.invoke("snippets:remove", { trigger }) as Promise<{
        ok: boolean;
        message?: string;
      }>,
  },
  styles: {
    list: () =>
      ipcRenderer.invoke("styles:list") as Promise<{
        ok: boolean;
        message?: string;
        items?: Array<{
          processName: string;
          tone: "professional" | "casual" | "neutral";
          updatedAt: string;
        }>;
      }>,
    set: (args: {
      processName: string;
      tone: "professional" | "casual" | "neutral";
    }) =>
      ipcRenderer.invoke("styles:set", args) as Promise<{
        ok: boolean;
        message?: string;
        entry?: {
          processName: string;
          tone: "professional" | "casual" | "neutral";
          updatedAt: string;
        };
      }>,
    remove: (processName: string) =>
      ipcRenderer.invoke("styles:remove", { processName }) as Promise<{
        ok: boolean;
        message?: string;
      }>,
  },
  notes: {
    list: () =>
      ipcRenderer.invoke("notes:list") as Promise<{
        ok: boolean;
        message?: string;
        items?: Array<{
          id: string;
          title: string;
          body: string;
          createdAt: string;
          updatedAt: string;
        }>;
      }>,
    create: (args?: { title?: string; body?: string }) =>
      ipcRenderer.invoke("notes:create", args ?? {}) as Promise<{
        ok: boolean;
        message?: string;
        note?: { id: string; title: string; body: string; createdAt: string; updatedAt: string };
      }>,
    update: (args: { id: string; title?: string; body?: string }) =>
      ipcRenderer.invoke("notes:update", args) as Promise<{
        ok: boolean;
        message?: string;
        note?: { id: string; title: string; body: string; createdAt: string; updatedAt: string };
      }>,
    delete: (id: string) =>
      ipcRenderer.invoke("notes:delete", { id }) as Promise<{ ok: boolean; message?: string }>,
    setActiveNote: (id: string | null) =>
      ipcRenderer.invoke("notes:setActiveNote", { id }) as Promise<{ ok: boolean }>,
  },
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
    cb: (payload: {
      action: "start" | "stop" | "cancel";
      mode?: "command" | "dictation" | "transform";
    }) => void,
  ): Unsubscribe => {
    const handler = (
      _: unknown,
      payload: {
        action: "start" | "stop" | "cancel";
        mode?: "command" | "dictation" | "transform";
      },
    ) => cb(payload);
    ipcRenderer.on("overlay:voice-toggle", handler);
    return () => ipcRenderer.removeListener("overlay:voice-toggle", handler);
  },
  pickDisambiguation: (path: string | null) =>
    ipcRenderer.invoke("disambiguation:pick", { path }) as Promise<{ ok: boolean }>,
  onDisambiguationShow: (
    cb: (payload: {
      spoken: string;
      items: Array<{ path: string; label: string }>;
    }) => void,
  ): Unsubscribe => {
    const handler = (_: unknown, payload: unknown) => cb(payload as never);
    ipcRenderer.on("disambiguation:show", handler);
    return () => ipcRenderer.removeListener("disambiguation:show", handler);
  },
  onDisambiguationHide: (cb: () => void): Unsubscribe => {
    const handler = () => cb();
    ipcRenderer.on("disambiguation:hide", handler);
    return () => ipcRenderer.removeListener("disambiguation:hide", handler);
  },
  onClarifyQuestion: (
    cb: (payload: { question: string }) => void,
  ): Unsubscribe => {
    const handler = (_: unknown, payload: unknown) => cb(payload as never);
    ipcRenderer.on("overlay:clarify", handler);
    return () => ipcRenderer.removeListener("overlay:clarify", handler);
  },
  onCodeRepairShow: (
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
  ): Unsubscribe => {
    const handler = (_: unknown, payload: unknown) => cb(payload as never);
    ipcRenderer.on("code-repair:show", handler);
    return () => ipcRenderer.removeListener("code-repair:show", handler);
  },
  onCodeRepairHide: (cb: () => void): Unsubscribe => {
    const handler = () => cb();
    ipcRenderer.on("code-repair:hide", handler);
    return () => ipcRenderer.removeListener("code-repair:hide", handler);
  },
  codeRepairAction: (action: "open" | "apply" | "ignore") =>
    ipcRenderer.invoke("code-repair:action", { action }) as Promise<{
      ok: boolean;
      error?: string;
    }>,
  isOverlay: () =>
    new URLSearchParams(window.location.search).get("overlay") === "1",
  memory: {
    ingestCrossApp: (args: {
      appId: string;
      summary: string;
      path?: string;
      contact?: string;
      command?: string;
      externalUrl?: string;
    }) =>
      ipcRenderer.invoke("memory:ingest-cross-app", args) as Promise<{
        ok: boolean;
        message?: string;
      }>,
    seedP8bTest: () =>
      ipcRenderer.invoke("memory:seed-p8b-test") as Promise<{
        ok: boolean;
        data?: {
          dir: string;
          ahmedPdf: string;
          goaPdf: string;
          voiceCommands: string[];
        };
        message?: string;
      }>,
    probeSemantic: (phrase: string) =>
      ipcRenderer.invoke("memory:probe-semantic", { phrase }) as Promise<{
        ok: boolean;
        embeddingPaths?: string[];
        semanticRefs?: string[];
      }>,
  },
};

contextBridge.exposeInMainWorld("ripple", api);

export type RippleApi = typeof api;
