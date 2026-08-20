import { app, ipcMain } from "electron";
// Crash visibility first — must be installed before any other module can throw.
import {
  crashBreadcrumb,
  getCrashLogDir,
  installMainCrashHandlers,
  writeCrashLog,
} from "../diagnostics/crashLog.js";
installMainCrashHandlers();
import { loadDesktopEnv, getSocketUrl } from "../config/env.js";
import { logPhaseBBootLine } from "../agent/planner/phaseBConfig.js";
import { logPlannerV2BootLine } from "../agent/planner/v2/plannerV2Config.js";
import { API_BASE } from "../services/api.js";
import {
  setVoiceInputReady,
  waitUntilVoiceInputReady,
} from "../services/bootReadiness.js";
import { rippleSocket } from "../socket/rippleSocket.js";
import { runDesktopCommand } from "../services/commandOrchestrator.js";
import {
  scanInstalledApps,
  startAppDiscoveryBackground,
} from "../automation/desktop/appDiscovery.js";
import { mergeDiscoveredApps, initNativeAppRegistry } from "../automation/desktop/nativeAppRegistry.js";
import { startFileIndexWatcher } from "../storage/fileIndexWatcher.js";
import { clearPreprocessCache } from "../automation/voice/nlu/preprocess.js";
import { buildContextMetadata } from "../automation/appDetector/contextBuilder.js";
import { readInstagramComposerText } from "../automation/adapters/instagram/readComposer.js";
import { readWhatsAppComposerText } from "../automation/adapters/whatsapp/readComposer.js";
import { readFocusedFieldText } from "../automation/desktop/readFocusedField.js";
import { isEditOrRephraseCommand } from "../automation/commandIntent.js";
import { isGmailComposeFocused, isInstagramTabActive, isWhatsAppTabActive, restoreFocusContext, startMediaFocusWatcher } from "../focus/focusContext.js";
import { extractRephraseSourceText } from "../automation/rephraseParse.js";
import { normalizeTranscript } from "../automation/voice/normalizeTranscript.js";
import {
  commandTextFromTranscript,
  languageHintForStt,
  logTranscriptStage,
  processTranscriptFromStt,
  sanitizeWhisperLanguageTag,
  transcriptDebugLabel,
} from "../automation/voice/transcriptPipeline.js";
import { setLastVoiceCommand } from "../state/lastCommand.js";
import {
  setVoiceSessionActive,
  setOverlayState,
  expandOverlayForLanguageMenu,
  collapseOverlayToIndicator,
  createOverlayWindow,
  showBootStartingOverlay,
  hideBootStartingOverlay,
  isInsertFailureHintActive,
} from "../windows/overlay.js";
import { initMain as initAudioLoopback } from "electron-audio-loopback";
import { isJarvisEnabled } from "../config/featureFlags.js";

loadDesktopEnv();
logPhaseBBootLine();
logPlannerV2BootLine();

// P10.2 — system audio loopback for Meeting Notetaker (must init before ready).
try {
  initAudioLoopback();
  console.info("[ripple-meeting] electron-audio-loopback initialized");
} catch (e: unknown) {
  console.warn(
    "[ripple-meeting] electron-audio-loopback init failed (mic-only fallback):",
    e instanceof Error ? e.message : e,
  );
}
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  hasTokens,
  saveTokens,
} from "../auth/tokenStore.js";
import {
  apiCommandHistory,
  apiEndSession,
  apiHealthCheck,
  apiLogin,
  apiLogout,
  apiMe,
  apiRefresh,
  apiSignup,
  apiStartSession,
  type AuthPayload,
} from "../services/api.js";
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from "../shortcuts/globalShortcut.js";
import { createTray, destroyTray } from "../tray/index.js";
import { createMainWindow, showMainWindow } from "../windows/mainWindow.js";
import { registerDisambiguationPickIpc } from "../windows/disambiguationPick.js";
import {
  registerCodeRepairPanelIpc,
  setCodeRepairApplyHandler,
} from "../windows/codeRepairPanel.js";
import {
  startWhatsAppExtensionBridge,
  stopWhatsAppExtensionBridge,
} from "../bridge/whatsappExtensionBridge.js";
import { initRippleDb, closeRippleDb } from "../storage/rippleDb.js";
import { listDesktopHistory } from "../storage/desktopHistory.js";
import {
  getFileIndexCount,
  rebuildFileIndex,
  startFileIndexBackground,
} from "../storage/fileIndex.js";
import { startSemanticIndexBackfill } from "../storage/recordFileTouch.js";
import { pruneActivityLogOlderThan } from "../storage/activityLog.js";
import { ingestCrossAppReference } from "../storage/crossAppIngest.js";
import { probeP8bSearch, seedP8bTestData, P8B_VOICE_COMMANDS } from "../storage/p8bTestSeed.js";
import { startOsTestBridge } from "../osTestBridge.js";
import { buildWorldModel } from "../agent/worldModel.js";
import { runPlannerPipelineAsync } from "../agent/planner/plannerPipeline.js";
import { setConfirmHandlerForTests } from "../automation/safety/executionGuard.js";
import { buildObservabilitySummary, buildCiGateSummary, exportTelemetryCsv } from "../telemetry/observabilityDashboard.js";
import { buildPlannerDashboardSummary } from "../agent/planner/planMetricsDashboard.js";
import {
  exportPlannerShadowCsv,
  getRecentExecutionObservations,
} from "../agent/planner/index.js";
import { getNativeCapabilities, initNativeHost, shutdownNativeHost } from "../native/nativeHost.js";
import { listRegisteredHotkeys } from "../native/hotkeyRegistry.js";
import { bootstrapDemoSeeds } from "../storage/bootstrapSeeds.js";
import { runPreflightHealth } from "../services/preflightHealth.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.error(
    "[ripple-desktop] Another Ripple instance is already running — focus that window, " +
      "or stop stale dev servers with: npm run dev:stop",
  );
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow({ userInitiated: true });
  });
}

let sessionId: string | null = null;
let currentUser: { id: string; email: string; onboarding_completed: boolean } | null =
  null;
let isQuitting = false;

/** W0.7 — single-flight dedupe for command:execute (see handler for detail). */
const COMMAND_DEDUPE_WINDOW_MS = 1500;
const inFlightCommandExecutions = new Map<
  string,
  { startedAt: number; promise: Promise<unknown> }
>();

async function ensureValidAccessToken(): Promise<string | null> {
  const access = await getAccessToken();
  if (access) return access;

  const refresh = await getRefreshToken();
  if (!refresh) return null;

  const res = await apiRefresh(refresh);
  if (!res.success) {
    await clearTokens();
    return null;
  }

  await saveTokens(res.data.token, res.data.refresh_token);
  return res.data.token;
}

async function bootstrapSession(access: string): Promise<void> {
  const res = await apiStartSession(access, {
    device: "ripple-desktop",
    context_type: "general",
    action_source: "desktop",
  });
  if (res.success) {
    sessionId = res.data.session_id;
  }
}

async function restoreAuth(): Promise<boolean> {
  const access = await ensureValidAccessToken();
  if (!access) return false;

  const me = await apiMe(access);
  if (!me.success) {
    await clearTokens();
    return false;
  }

  currentUser = {
    id: me.data.id,
    email: me.data.email,
    onboarding_completed: me.data.onboarding_completed,
  };
  await bootstrapSession(access);
  await connectSocket(access);
  // P9.1.C — restart-time restore counts as a login for sync purposes too;
  // don't block startup on it.
  void import("../sync/syncClient.js").then((m) => m.runLoginSync());
  return true;
}

async function connectSocket(accessToken: string): Promise<void> {
  try {
    await rippleSocket.connect(accessToken);
  } catch (e: unknown) {
    console.error(
      "[ripple-desktop] socket connect failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

function formatAuthError(res: { message: string; error?: string }): string {
  return res.error ? `${res.message}: ${res.error}` : res.message;
}

function friendlyAuthMessage(message: string, action: "login" | "signup"): string {
  if (message === "Invalid credentials") {
    return action === "login"
      ? "Wrong email or password. Use Sign up if you don't have an account yet."
      : message;
  }
  if (message === "Email already exists") {
    return "That email is already registered — switch to Sign in.";
  }
  return message;
}

function logApi(
  method: string,
  path: string,
  ok: boolean,
  detail?: string,
): void {
  const tag = ok ? "OK" : "FAIL";
  const extra = detail ? ` - ${detail}` : "";
  console.info(`[ripple-desktop] ${method} ${path} -> ${tag}${extra}`);
}

async function endActiveSession(): Promise<void> {
  if (!sessionId) return;
  const access = await getAccessToken();
  if (!access) return;
  const id = sessionId;
  const res = await apiEndSession(access, id);
  if (res.success) {
    logApi("POST", "/session/end", true, id);
  } else {
    logApi("POST", "/session/end", false, res.message);
  }
  sessionId = null;
}

async function handleLogout(): Promise<void> {
  await endActiveSession();
  rippleSocket.disconnect();
  const access = await getAccessToken();
  const refresh = await getRefreshToken();
  if (access && refresh) {
    await apiLogout(access, refresh).catch(() => undefined);
  }
  await clearTokens();
  currentUser = null;
}

async function completeAuth(data: AuthPayload): Promise<{
  ok: true;
  user: typeof currentUser;
  sessionId: string | null;
}> {
  await saveTokens(data.token, data.refresh_token);
  currentUser = {
    id: data.user.id,
    email: data.user.email,
    onboarding_completed: data.user.onboarding_completed,
  };
  await bootstrapSession(data.token);
  await connectSocket(data.token);
  // P9.1.C — shared by interactive login and signup; don't block the
  // caller's response on this.
  void import("../sync/syncClient.js").then((m) => m.runLoginSync());
  return { ok: true, user: currentUser, sessionId };
}

function registerIpc(): void {
  // Renderer crash reports (installed in preload for every renderer window).
  ipcMain.on("diag:renderer-crash", (_e, payload: Record<string, unknown>) => {
    const kind =
      typeof payload?.kind === "string" ? payload.kind : "renderer.unknown";
    const message =
      typeof payload?.message === "string" ? payload.message : "renderer error";
    const err = new Error(message);
    if (typeof payload?.stack === "string") err.stack = payload.stack;
    writeCrashLog(kind, err, payload);
  });

  registerDisambiguationPickIpc();
  registerCodeRepairPanelIpc();
  setCodeRepairApplyHandler(async () => {
    await runDesktopCommand({
      command: "yes, apply fixes",
      sessionId,
      getAccessToken: ensureValidAccessToken,
    });
  });

  ipcMain.handle("api:health", async () => {
    const result = await apiHealthCheck();
    logApi("GET", "/health", result.ok, result.message);
    return result;
  });

  ipcMain.handle("preflight:health", async () => {
    const report = await runPreflightHealth(async () => {
      const h = await apiHealthCheck();
      return h.ok;
    });
    return { ok: true, ...report };
  });

  ipcMain.handle(
    "auth:login",
    async (_e, args: { email: string; password: string }) => {
      try {
        const res = await apiLogin({
          email: args.email,
          password: args.password,
        });
        if (!res.success) {
          const msg = friendlyAuthMessage(formatAuthError(res), "login");
          logApi("POST", "/auth/login", false, msg);
          return { ok: false, message: msg };
        }
        logApi("POST", "/auth/login", true, args.email);
        return await completeAuth(res.data);
      } catch (e: unknown) {
        const msg =
          e instanceof Error && e.message.includes("ECONNREFUSED")
            ? `Cannot reach backend at ${API_BASE}. Is ripple-backend running on the same port?`
            : e instanceof Error
              ? e.message
              : "Login failed";
        return { ok: false, message: msg };
      }
    },
  );

  ipcMain.handle(
    "auth:signup",
    async (_e, args: { email: string; password: string; name?: string }) => {
      try {
        const res = await apiSignup({
          email: args.email,
          password: args.password,
          name: args.name,
        });
        if (!res.success) {
          const msg = friendlyAuthMessage(formatAuthError(res), "signup");
          logApi("POST", "/auth/signup", false, msg);
          return { ok: false, message: msg };
        }
        logApi("POST", "/auth/signup", true, args.email);
        return await completeAuth(res.data);
      } catch (e: unknown) {
        const msg =
          e instanceof Error && e.message.includes("ECONNREFUSED")
            ? `Cannot reach backend at ${API_BASE}. Is ripple-backend running on the same port?`
            : e instanceof Error
              ? e.message
              : "Signup failed";
        logApi("POST", "/auth/signup", false, msg);
        return { ok: false, message: msg };
      }
    },
  );

  ipcMain.handle("auth:logout", async () => {
    await handleLogout();
    return { ok: true };
  });

  ipcMain.handle("auth:session", async () => {
    if (!(await hasTokens())) {
      return { loggedIn: false };
    }
    if (!currentUser) {
      const ok = await restoreAuth();
      if (!ok) return { loggedIn: false };
    }
    return { loggedIn: true, user: currentUser, sessionId };
  });

  ipcMain.handle("socket:status", () => ({
    status: rippleSocket.getStatus(),
    connected: rippleSocket.isConnected(),
    sessionId,
  }));

  ipcMain.handle(
    "voice:chunk",
    async (
      _e,
      args: {
        streamId: string;
        sessionId?: string;
        chunk: Uint8Array;
        mimeType?: string;
        filename?: string;
      },
    ) => {
      if (!rippleSocket.isConnected()) {
        return {
          ok: false,
          message:
            "Not connected to server. Check backend is running and wait for socket to reconnect.",
        };
      }
      try {
        const data = await rippleSocket.sendVoiceChunk({
          streamId: args.streamId,
          sessionId: args.sessionId ?? sessionId ?? undefined,
          chunk: Buffer.from(args.chunk),
          mimeType: args.mimeType,
          filename: args.filename,
        });
        return { ok: true, data };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Voice chunk failed",
        };
      }
    },
  );

  // P7.8 — mid-utterance Whisper flush → voice:partial_transcript.
  ipcMain.handle(
    "voice:flush",
    async (
      _e,
      args: { streamId: string; sessionId?: string; language?: string },
    ) => {
      if (!rippleSocket.isConnected()) {
        return { ok: false, message: "Not connected to server." };
      }
      try {
        const data = await rippleSocket.flushVoice(
          args.streamId,
          args.sessionId ?? sessionId ?? undefined,
          args.language,
        );
        return { ok: true, data };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Voice flush failed",
        };
      }
    },
  );

  // P7.8 — start progressive-insert session for this stream.
  ipcMain.handle(
    "streaming:begin",
    async (_e, args: { streamId?: string }) => {
      try {
        const streamId =
          typeof args?.streamId === "string" ? args.streamId : "";
        if (!streamId) return { ok: false, message: "stream_id_required" };
        const { getActiveNoteId } = await import("../state/activeNoteFocus.js");
        const noteId = getActiveNoteId();
        let noteBaseBody = "";
        if (noteId) {
          const { getNote } = await import("../storage/notes.js");
          noteBaseBody = getNote(noteId)?.body ?? "";
        }
        const { beginStreamingInsert } = await import(
          "../agent/dictation/streamingInsert.js"
        );
        beginStreamingInsert({ streamId, noteId, noteBaseBody });
        return { ok: true };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "streaming_begin_failed",
        };
      }
    },
  );

  ipcMain.handle("streaming:clear", async () => {
    try {
      const { clearStreamingInsert } = await import(
        "../agent/dictation/streamingInsert.js"
      );
      clearStreamingInsert();
      return { ok: true };
    } catch {
      return { ok: true };
    }
  });

  ipcMain.handle(
    "voice:end",
    async (
      _e,
      args: {
        streamId: string;
        sessionId?: string;
        language?: string;
        dictationClean?: boolean;
      },
    ) => {
      try {
        // Latency Phase 4 — start the screen gather NOW so its UIA+OCR wall
        // time overlaps the STT round trip below instead of being added to
        // stop→paste after it. Fire-and-forget; compose consumes the result if
        // it is ready and falls back to gathering inline if it is not.
        void import("../agent/dictation/screenNameBias.js")
          .then((m) => m.prewarmScreenContext())
          .catch(() => undefined);

        const data = await rippleSocket.endVoice(
          args.streamId,
          args.sessionId ?? sessionId ?? undefined,
          languageHintForStt(args.language),
          args.dictationClean === true,
        );
        const payload = (data ?? {}) as {
          text?: string;
          raw_text?: string;
          cleaned?: boolean;
          language?: string;
          timings?: { stt_ms: number; llm_ms: number; total_ms: number };
        };
        const text = payload?.text;
        if (text) {
          payload.language = sanitizeWhisperLanguageTag(text, payload.language);
          const snapshot = processTranscriptFromStt(text, payload.language);
          logTranscriptStage("stt_raw", { ...snapshot, text: snapshot.raw });
          logTranscriptStage("after_utf_repair", {
            ...snapshot,
            text: snapshot.repaired,
          });
          logTranscriptStage("after_stt_correction", {
            ...snapshot,
            text: snapshot.corrected,
          });
          logTranscriptStage("after_normalize", {
            ...snapshot,
            text: snapshot.normalized,
          });
          logTranscriptStage("after_translation", {
            ...snapshot,
            text: snapshot.nlu,
          });
          console.info(
            `[ripple-desktop] voice transcript: ${transcriptDebugLabel(text)}`,
          );
          if (payload.timings) {
            console.info(
              `[ripple-latency] backend_pipeline stt=${payload.timings.stt_ms}ms llm=${payload.timings.llm_ms}ms total=${payload.timings.total_ms}ms cleaned=${payload.cleaned ? 1 : 0}`,
            );
          }
          if (snapshot.wasMojibake) {
            console.info(
              `[ripple-desktop] voice transcript repaired → ${transcriptDebugLabel(snapshot.normalized)}`,
            );
          }
        }
        return { ok: true, data: payload };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Voice end failed",
        };
      }
    },
  );

  ipcMain.handle("voice:cancel", async (_e, args: { streamId: string }) => {
    try {
      await rippleSocket.cancelVoice(args.streamId);
      return { ok: true };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Voice cancel failed",
      };
    }
  });

  ipcMain.handle(
    "history:list",
    async (
      _e,
      args: {
        page?: number;
        limit?: number;
        intent?: string;
        context_type?: string;
        action_source?: string;
      },
    ) => {
      const access = await ensureValidAccessToken();
      if (!access) {
        return { ok: false, message: "Not authenticated" };
      }
      const res = await apiCommandHistory(access, {
        page: args.page,
        limit: args.limit,
        intent: args.intent,
        context_type: args.context_type,
        action_source: args.action_source,
      });
      if (!res.success) {
        return { ok: false, message: res.message };
      }
      return {
        ok: true,
        items: res.data.items,
        total: res.data.total,
        page: res.data.page,
        limit: res.data.limit,
      };
    },
  );

  ipcMain.handle("dictation:execute", async (_e, args) => {
    const { executeDictationUtterance } = await import(
      "../agent/dictation/executeDictation.js"
    );
    const text = typeof args?.text === "string" ? args.text : "";
    console.info(
      `[ripple-desktop] dictation:execute (${text.length} chars)`,
    );
    return executeDictationUtterance(text, {
      insert: args?.insert !== false,
      requestedLanguage:
        typeof args?.requestedLanguage === "string" ? args.requestedLanguage : undefined,
      detectedLanguage:
        typeof args?.detectedLanguage === "string" ? args.detectedLanguage : undefined,
      backendCleaned: args?.backendCleaned === true,
    });
  });

  // Phase 7.5 — multi-utterance dictation session window (~20 min).
  ipcMain.handle("dictation:sessionStatus", async () => {
    const { getSessionStatus } = await import(
      "../agent/dictation/dictationSessionWindow.js"
    );
    return { ok: true, session: getSessionStatus() };
  });

  // Phase 9.5 — dictation language picker (Whisper language override).
  ipcMain.handle("language:get", async () => {
    const { getUserPreferences } = await import("../storage/userPreferences.js");
    try {
      return { ok: true, language: getUserPreferences().language || "auto" };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "language_get_failed",
      };
    }
  });

  ipcMain.handle("language:set", async (_e, args) => {
    const { updateUserPreference } = await import("../storage/userPreferences.js");
    const language = typeof args?.language === "string" ? args.language.trim() : "";
    if (!language) return { ok: false, message: "missing_arg:language" };
    try {
      const prefs = updateUserPreference("language", language);
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("preference", "language", { value: prefs.language });
      return { ok: true, language: prefs.language || "auto" };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "language_set_failed",
      };
    }
  });

  // Phase 9.6 — quiet/whisper dictation mode.
  ipcMain.handle("quietMode:get", async () => {
    const { getUserPreferences } = await import("../storage/userPreferences.js");
    try {
      return { ok: true, quietMode: getUserPreferences().quietMode === "1" };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "quiet_mode_get_failed",
      };
    }
  });

  ipcMain.handle("quietMode:set", async (_e, args) => {
    const { updateUserPreference } = await import("../storage/userPreferences.js");
    const enabled = args?.enabled === true;
    try {
      const prefs = updateUserPreference("quiet_mode", enabled ? "1" : "0");
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("preference", "quiet_mode", { value: prefs.quietMode });
      return { ok: true, quietMode: prefs.quietMode === "1" };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "quiet_mode_set_failed",
      };
    }
  });

  ipcMain.handle("micDevice:get", async () => {
    const { getUserPreferences } = await import("../storage/userPreferences.js");
    try {
      const prefs = getUserPreferences();
      return { ok: true, deviceId: prefs.micDeviceId ?? "" };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "mic_device_get_failed",
      };
    }
  });

  ipcMain.handle("micDevice:set", async (_e, args) => {
    const { updateUserPreference } = await import("../storage/userPreferences.js");
    const deviceId = typeof args?.deviceId === "string" ? args.deviceId.trim() : "";
    try {
      const prefs = updateUserPreference("mic_device_id", deviceId);
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("preference", "mic_device_id", { value: prefs.micDeviceId });
      return { ok: true, deviceId: prefs.micDeviceId ?? "" };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "mic_device_set_failed",
      };
    }
  });

  ipcMain.handle("pipeline:get", async () => {
    try {
      const { getUserPreferences } = await import("../storage/userPreferences.js");
      const { parsePipelineLayers, cleanupLevelForLayers } = await import(
        "../agent/dictation/pipelineLayers.js"
      );
      const layers = parsePipelineLayers(getUserPreferences().pipelineLayers);
      return { ok: true, layers, level: cleanupLevelForLayers(layers) };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "pipeline_get_failed",
      };
    }
  });

  ipcMain.handle("pipeline:set", async (_e, args) => {
    try {
      const { updateUserPreference } = await import("../storage/userPreferences.js");
      const {
        layersForCleanupLevel,
        parseCleanupLevel,
        serializePipelineLayers,
        cleanupLevelForLayers,
      } = await import("../agent/dictation/pipelineLayers.js");

      const layers =
        typeof args?.level === "string"
          ? layersForCleanupLevel(parseCleanupLevel(args.level))
          : {
              transcribe: true as const,
              cleanup: args?.cleanup === true,
              format: args?.format === true,
              context: args?.context === true,
            };
      const prefs = updateUserPreference(
        "pipeline_layers",
        serializePipelineLayers(layers),
      );
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("preference", "pipeline_layers", {
        value: prefs.pipelineLayers,
      });
      return { ok: true, layers, level: cleanupLevelForLayers(layers) };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "pipeline_set_failed",
      };
    }
  });

  // Phase 7.4 — Dictionary UI (personal spoken -> canonical corrections).
  ipcMain.handle("dictionary:list", async () => {
    const { listCorrections } = await import(
      "../storage/voiceCorrections.js"
    );
    try {
      return { ok: true, items: listCorrections(200) };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "dictionary_list_failed",
      };
    }
  });

  ipcMain.handle("dictionary:add", async (_e, args) => {
    const { learnCorrection } = await import(
      "../storage/voiceCorrections.js"
    );
    const spokenForm = typeof args?.spokenForm === "string" ? args.spokenForm.trim() : "";
    const canonicalForm =
      typeof args?.canonicalForm === "string" ? args.canonicalForm.trim() : "";
    if (!spokenForm || !canonicalForm) {
      return { ok: false, message: "Both fields are required" };
    }
    try {
      const entry = learnCorrection({ spokenForm, canonicalForm, source: "dictionary_ui" });
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("dictionary", entry.spokenForm, {
        canonicalForm: entry.canonicalForm,
        source: entry.source,
      });
      return { ok: true, entry };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "dictionary_add_failed",
      };
    }
  });

  ipcMain.handle("dictionary:remove", async (_e, args) => {
    const { removeCorrection } = await import(
      "../storage/voiceCorrections.js"
    );
    const spokenForm = typeof args?.spokenForm === "string" ? args.spokenForm : "";
    if (!spokenForm) return { ok: false, message: "missing_arg:spokenForm" };
    try {
      const removed = removeCorrection(spokenForm);
      if (removed) {
        const { pushSyncItemAsync } = await import("../sync/syncClient.js");
        // Match voiceCorrections.ts's own key normalization so this tombstone
        // lands on the same sync key the add-side push used.
        const normalizedKey = spokenForm.trim().toLowerCase().replace(/\s+/g, " ");
        pushSyncItemAsync("dictionary", normalizedKey, {}, true);
      }
      return { ok: removed };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "dictionary_remove_failed",
      };
    }
  });

  // Phase 7.2 — Snippets (voice-triggered text expansion).
  ipcMain.handle("snippets:list", async () => {
    const { listSnippets } = await import("../storage/snippets.js");
    try {
      return { ok: true, items: listSnippets(200) };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "snippets_list_failed",
      };
    }
  });

  ipcMain.handle("snippets:add", async (_e, args) => {
    const { learnSnippet } = await import("../storage/snippets.js");
    const trigger = typeof args?.trigger === "string" ? args.trigger.trim() : "";
    const expansion =
      typeof args?.expansion === "string" ? args.expansion.trim() : "";
    if (!trigger || !expansion) {
      return { ok: false, message: "Both fields are required" };
    }
    try {
      const entry = learnSnippet({ trigger, expansion });
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("snippet", entry.trigger, { expansion: entry.expansion });
      return { ok: true, entry };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "snippets_add_failed",
      };
    }
  });

  ipcMain.handle("snippets:remove", async (_e, args) => {
    const { removeSnippet, normalizeTrigger } = await import("../storage/snippets.js");
    const trigger = typeof args?.trigger === "string" ? args.trigger : "";
    if (!trigger) return { ok: false, message: "missing_arg:trigger" };
    try {
      const removed = removeSnippet(trigger);
      if (removed) {
        const { pushSyncItemAsync } = await import("../sync/syncClient.js");
        pushSyncItemAsync("snippet", normalizeTrigger(trigger), {}, true);
      }
      return { ok: removed };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "snippets_remove_failed",
      };
    }
  });

  // Phase 7.3 — Styles (per-app ambient dictation tone).
  ipcMain.handle("styles:list", async () => {
    const { listStyleProfiles } = await import("../storage/styleProfiles.js");
    try {
      return { ok: true, items: listStyleProfiles() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "styles_list_failed",
      };
    }
  });

  ipcMain.handle("styles:set", async (_e, args) => {
    const { setStyleProfile } = await import("../storage/styleProfiles.js");
    const processName =
      typeof args?.processName === "string" ? args.processName.trim() : "";
    const tone = typeof args?.tone === "string" ? args.tone : "";
    const { isStyleTone } = await import("../storage/styleTone.js");
    if (!processName || !isStyleTone(tone)) {
      return { ok: false, message: "processName and a valid tone are required" };
    }
    try {
      const entry = setStyleProfile({
        processName,
        tone,
      });
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      // setStyleProfile deletes the row for "neutral" (no override) — sync
      // that as a tombstone, not a stored "neutral" style.
      if (entry.tone === "neutral") {
        pushSyncItemAsync("style", entry.processName, {}, true);
      } else {
        pushSyncItemAsync("style", entry.processName, { tone: entry.tone });
      }
      return { ok: true, entry };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "styles_set_failed",
      };
    }
  });

  ipcMain.handle("styles:remove", async (_e, args) => {
    const { removeStyleProfile } = await import("../storage/styleProfiles.js");
    const processName = typeof args?.processName === "string" ? args.processName : "";
    if (!processName) return { ok: false, message: "missing_arg:processName" };
    try {
      const removed = removeStyleProfile(processName);
      if (removed) {
        const { pushSyncItemAsync } = await import("../sync/syncClient.js");
        pushSyncItemAsync("style", processName.trim().toLowerCase(), {}, true);
      }
      return { ok: removed };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "styles_remove_failed",
      };
    }
  });

  // Phase 10.1 — Flow Notes.
  ipcMain.handle("notes:list", async () => {
    const { listNotes } = await import("../storage/notes.js");
    try {
      return { ok: true, items: listNotes(200) };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : "notes_list_failed" };
    }
  });

  ipcMain.handle("notes:create", async (_e, args) => {
    const { createNote } = await import("../storage/notes.js");
    const title = typeof args?.title === "string" ? args.title : undefined;
    const body = typeof args?.body === "string" ? args.body : undefined;
    try {
      const note = createNote({ title, body });
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("note", note.id, {
        title: note.title,
        body: note.body,
        createdAt: note.createdAt,
      });
      return { ok: true, note };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : "notes_create_failed" };
    }
  });

  ipcMain.handle("notes:update", async (_e, args) => {
    const { updateNote } = await import("../storage/notes.js");
    const id = typeof args?.id === "string" ? args.id : "";
    if (!id) return { ok: false, message: "missing_arg:id" };
    const title = typeof args?.title === "string" ? args.title : undefined;
    const body = typeof args?.body === "string" ? args.body : undefined;
    try {
      const note = updateNote(id, { title, body });
      if (!note) return { ok: false, message: "note_not_found" };
      const { pushSyncItemAsync } = await import("../sync/syncClient.js");
      pushSyncItemAsync("note", note.id, {
        title: note.title,
        body: note.body,
        createdAt: note.createdAt,
      });
      return { ok: true, note };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : "notes_update_failed" };
    }
  });

  ipcMain.handle("notes:delete", async (_e, args) => {
    const { deleteNote } = await import("../storage/notes.js");
    const id = typeof args?.id === "string" ? args.id : "";
    if (!id) return { ok: false, message: "missing_arg:id" };
    try {
      const removed = deleteNote(id);
      if (removed) {
        const { pushSyncItemAsync } = await import("../sync/syncClient.js");
        pushSyncItemAsync("note", id, {}, true);
      }
      return { ok: removed };
    } catch (e: unknown) {
      return { ok: false, message: e instanceof Error ? e.message : "notes_delete_failed" };
    }
  });

  // P10.1 — renderer reports focus/blur of a note's body textarea so
  // focusedFieldDictation.ts can allow Shift+Space dictation into it
  // (Ripple's own windows are excluded from that path by default).
  ipcMain.handle("notes:setActiveNote", async (_e, args) => {
    const { setActiveNoteId } = await import("../state/activeNoteFocus.js");
    const id = typeof args?.id === "string" ? args.id : null;
    setActiveNoteId(id);
    return { ok: true };
  });

  ipcMain.handle("command:execute", (_e, args) => {
    if (!isJarvisEnabled()) {
      return Promise.resolve({
        ok: false,
        message: "Command mode is off. Use Shift+Space to dictate.",
      });
    }
    const snapshot = processTranscriptFromStt(args.command ?? "");
    const cmd = commandTextFromTranscript(snapshot);

    // W0.7 — single-flight: the same utterance has been observed dispatching
    // twice in quick succession (distinct command_ids, ~200-260ms apart —
    // e.g. automation.open_project firing 3x for one "open horizon-backend").
    // The exact upstream trigger wasn't pinned down live, so guard here at
    // the actual execution boundary regardless of cause. The check-and-set
    // below happens synchronously (no await in between) so two calls that
    // arrive back-to-back can't both slip past the check before either
    // registers itself — the previous version raced here since context
    // building (buildContextMetadata, focused-text reads) ran before the
    // map was populated.
    const dedupeKey = cmd.trim().toLowerCase();
    if (dedupeKey) {
      const existing = inFlightCommandExecutions.get(dedupeKey);
      if (existing && Date.now() - existing.startedAt < COMMAND_DEDUPE_WINDOW_MS) {
        console.warn(
          `[ripple-desktop] command:execute dedupe — reusing in-flight result for "${dedupeKey.slice(0, 60)}"`,
        );
        return existing.promise;
      }
    }

    const execution = (async () => {
      clearPreprocessCache();
      setLastVoiceCommand(cmd);
      logTranscriptStage("command_execute", {
        ...snapshot,
        text: cmd,
      });
      const preview = cmd.length > 200 ? `${cmd.slice(0, 200)}…` : cmd;
      console.info(
        `[ripple-desktop] command:execute (${cmd.length} chars): ${transcriptDebugLabel(preview, 80)}`,
      );
      const contextMetadata = {
        ...(await buildContextMetadata()),
        ...args.contextMetadata,
      };
      let selectedText = extractRephraseSourceText(cmd) ?? undefined;
      if (!selectedText && isGmailComposeFocused()) {
        const fromCompose = await readFocusedFieldText();
        if (fromCompose?.trim()) {
          selectedText = fromCompose.trim();
          console.info(
            `[ripple-desktop] Gmail compose — ${selectedText.length} chars from open body`,
          );
        }
      }
      if (!selectedText && isEditOrRephraseCommand(cmd)) {
        if (isInstagramTabActive()) {
          const fromComposer = await readInstagramComposerText();
          if (fromComposer?.trim()) {
            selectedText = fromComposer.trim();
            console.info(
              `[ripple-desktop] DM rephrase — ${selectedText.length} chars from open composer`,
            );
          }
        } else if (isWhatsAppTabActive()) {
          await restoreFocusContext();
          await new Promise((r) => setTimeout(r, 350));
          const fromComposer = await readWhatsAppComposerText();
          if (fromComposer?.trim()) {
            selectedText = fromComposer.trim();
            console.info(
              `[ripple-desktop] WA rephrase — ${selectedText.length} chars from open composer`,
            );
          }
        }
      }
      return runDesktopCommand({
        command: cmd,
        sessionId: args.sessionId ?? sessionId,
        contextMetadata,
        selectedText,
        getAccessToken: ensureValidAccessToken,
      });
    })();

    if (dedupeKey) {
      inFlightCommandExecutions.set(dedupeKey, {
        startedAt: Date.now(),
        promise: execution,
      });
      execution.finally(() => {
        // Keep the entry through COMMAND_DEDUPE_WINDOW_MS after completion —
        // covers duplicates that arrive just after the first finishes, not
        // only ones that overlap it — then drop it so the phrase can be
        // spoken again normally.
        setTimeout(() => {
          const current = inFlightCommandExecutions.get(dedupeKey);
          if (current?.promise === execution) {
            inFlightCommandExecutions.delete(dedupeKey);
          }
        }, COMMAND_DEDUPE_WINDOW_MS);
      });
    }

    return execution;
  });

  ipcMain.handle(
    "desktop-history:list",
    async (_e, args: { limit?: number } = {}) => {
      try {
        const items = listDesktopHistory(args.limit ?? 50);
        return { ok: true, items };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Failed to load local history",
        };
      }
    },
  );

  ipcMain.handle("file-index:status", async () => {
    try {
      return { ok: true, count: getFileIndexCount() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "File index unavailable",
      };
    }
  });

  ipcMain.handle("file-index:rebuild", async () => {
    try {
      const count = rebuildFileIndex();
      return { ok: true, count };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "File index rebuild failed",
      };
    }
  });

  ipcMain.handle("telemetry:p85", async () => {
    try {
      return {
        ok: true,
        dashboard: {
          ...buildPlannerDashboardSummary(500),
          recentObservations: getRecentExecutionObservations(15),
        },
      };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "P8.5 metrics unavailable",
      };
    }
  });

  ipcMain.handle("telemetry:p85:export", async () => {
    try {
      return { ok: true, csv: exportPlannerShadowCsv(500) };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "P8.5 export failed",
      };
    }
  });

  ipcMain.handle("telemetry:summary", async () => {
    try {
      return { ok: true, summary: buildObservabilitySummary() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Telemetry unavailable",
      };
    }
  });

  ipcMain.handle("telemetry:export", async () => {
    try {
      return { ok: true, csv: exportTelemetryCsv(500) };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Export failed",
      };
    }
  });

  ipcMain.handle("telemetry:gate", async () => {
    try {
      return { ok: true, gate: buildCiGateSummary() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "CI gate unavailable",
      };
    }
  });

  ipcMain.handle("native:capabilities", async () => {
    try {
      return {
        ok: true,
        capabilities: getNativeCapabilities(),
        hotkeys: listRegisteredHotkeys(),
      };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Native layer unavailable",
      };
    }
  });

  ipcMain.handle("overlay:voice-active", (_e, active: boolean) => {
    setVoiceSessionActive(active);
    if (!active && !isInsertFailureHintActive()) setOverlayState("idle");
    return { ok: true };
  });

  // P11.2 — Flow Bar language menu (renderer-initiated resize, unlike the
  // other overlay expand* calls which are all pushed from backend events).
  ipcMain.handle("overlay:expandLanguageMenu", (_e, itemCount: number) => {
    expandOverlayForLanguageMenu(typeof itemCount === "number" ? itemCount : 8);
    return { ok: true };
  });

  ipcMain.handle("overlay:collapseToIndicator", () => {
    collapseOverlayToIndicator();
    return { ok: true };
  });

  // P11.3 — Flow Bar Scratchpad / Notes button.
  ipcMain.handle("flowBar:openScratchpad", async () => {
    try {
      const { handleScratchpadFromFlowBar } = await import("../windows/overlay.js");
      await handleScratchpadFromFlowBar();
      return { ok: true };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "scratchpad_failed",
      };
    }
  });

  // P11.4 — Flow Bar Transforms wand (same path as F9).
  ipcMain.handle("flowBar:startTransform", async () => {
    try {
      const { handleTransformShortcutPress } = await import("../windows/overlay.js");
      await handleTransformShortcutPress();
      return { ok: true };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "transform_failed",
      };
    }
  });

  // P10.2 — Meeting Notetaker IPC.
  ipcMain.handle("meeting:getState", async () => {
    try {
      const { getMeetingState } = await import(
        "../agent/meeting/meetingRecorder.js"
      );
      return { ok: true, state: getMeetingState() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "meeting_state_failed",
      };
    }
  });

  ipcMain.handle("meeting:toggle", async () => {
    try {
      const { handleMeetingShortcutPress } = await import("../windows/overlay.js");
      await handleMeetingShortcutPress();
      const { getMeetingState } = await import(
        "../agent/meeting/meetingRecorder.js"
      );
      return { ok: true, state: getMeetingState() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "meeting_toggle_failed",
      };
    }
  });

  ipcMain.handle("meeting:acceptConsent", async () => {
    try {
      const { acceptMeetingConsentAndStart } = await import(
        "../windows/overlay.js"
      );
      await acceptMeetingConsentAndStart();
      return { ok: true };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "meeting_consent_failed",
      };
    }
  });

  ipcMain.handle("meeting:declineConsent", async () => {
    try {
      const { declineMeetingConsentAndClose } = await import(
        "../windows/overlay.js"
      );
      await declineMeetingConsentAndClose();
      return { ok: true };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "meeting_decline_failed",
      };
    }
  });

  ipcMain.handle("meeting:stop", async () => {
    try {
      const { stopMeetingRecording, isMeetingRecording } = await import(
        "../agent/meeting/meetingRecorder.js"
      );
      if (isMeetingRecording()) {
        await stopMeetingRecording();
      }
      const { getMeetingState } = await import(
        "../agent/meeting/meetingRecorder.js"
      );
      return { ok: true, state: getMeetingState() };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "meeting_stop_failed",
      };
    }
  });

  ipcMain.handle(
    "meeting:chunk",
    async (
      _e,
      args: {
        chunk?: Uint8Array | ArrayBuffer | number[];
        mimeType?: string;
        filename?: string;
      },
    ) => {
      try {
        const { appendMeetingChunk } = await import(
          "../agent/meeting/meetingRecorder.js"
        );
        let buffer: Uint8Array;
        if (args.chunk instanceof Uint8Array) {
          buffer = args.chunk;
        } else if (args.chunk instanceof ArrayBuffer) {
          buffer = new Uint8Array(args.chunk);
        } else if (Array.isArray(args.chunk)) {
          buffer = Uint8Array.from(args.chunk);
        } else {
          console.warn("[ripple-meeting] chunk IPC missing buffer");
          return { ok: false, message: "chunk_required" };
        }
        console.info(
          `[ripple-meeting] chunk IPC bytes=${buffer.byteLength} mime=${args.mimeType ?? "?"}`,
        );
        return await appendMeetingChunk({
          buffer,
          mimeType: args.mimeType,
          filename: args.filename,
        });
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "meeting_chunk_failed",
        };
      }
    },
  );

  ipcMain.handle(
    "meeting:end",
    async (
      _e,
      args?: {
        chunk?: Uint8Array | ArrayBuffer | number[];
        mimeType?: string;
        filename?: string;
      },
    ) => {
      try {
        const { stopMeetingRecording } = await import(
          "../agent/meeting/meetingRecorder.js"
        );
        let finalChunk:
          | {
              buffer: Uint8Array;
              mimeType?: string;
              filename?: string;
            }
          | undefined;
        if (args?.chunk) {
          let buffer: Uint8Array;
          if (args.chunk instanceof Uint8Array) {
            buffer = args.chunk;
          } else if (args.chunk instanceof ArrayBuffer) {
            buffer = new Uint8Array(args.chunk);
          } else if (Array.isArray(args.chunk)) {
            buffer = Uint8Array.from(args.chunk);
          } else {
            buffer = new Uint8Array();
          }
          if (buffer.byteLength > 0) {
            finalChunk = {
              buffer,
              mimeType: args.mimeType,
              filename: args.filename,
            };
          }
        }
        const state = await stopMeetingRecording(
          finalChunk ? { finalChunk } : undefined,
        );
        console.info(
          `[ripple-meeting] end IPC finalBytes=${finalChunk?.buffer.byteLength ?? 0}`,
        );
        return { ok: true, state };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "meeting_end_failed",
        };
      }
    },
  );

  /** P8b — extension / bridge records email, Slack, etc. file references. */
  ipcMain.handle(
    "memory:ingest-cross-app",
    async (
      _e,
      args: {
        appId?: string;
        summary?: string;
        path?: string;
        contact?: string;
        command?: string;
        externalUrl?: string;
      },
    ) => {
      try {
        const appId = args.appId?.trim().toLowerCase();
        const summary = args.summary?.trim();
        if (!appId || !summary) {
          return { ok: false, message: "appId and summary required" };
        }
        const allowed = new Set([
          "gmail",
          "slack",
          "email",
          "whatsapp",
          "teams",
          "outlook",
        ]);
        if (!allowed.has(appId)) {
          return { ok: false, message: `Unsupported appId: ${appId}` };
        }
        ingestCrossAppReference({
          appId: appId as import("../storage/crossAppIngest.js").CrossAppId,
          summary,
          path: args.path ?? null,
          contact: args.contact ?? null,
          command: args.command ?? null,
          externalUrl: args.externalUrl ?? null,
        });
        return { ok: true };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Ingest failed",
        };
      }
    },
  );

  ipcMain.handle("memory:seed-p8b-test", async () => {
    try {
      const data = seedP8bTestData();
      return {
        ok: true,
        data: {
          ...data,
          voiceCommands: [...P8B_VOICE_COMMANDS],
        },
      };
    } catch (e: unknown) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "Seed failed",
      };
    }
  });

  ipcMain.handle(
    "memory:probe-semantic",
    async (_e, args: { phrase?: string }) => {
      const phrase = args.phrase?.trim();
      if (!phrase) return { ok: false, message: "phrase required" };
      try {
        const probe = probeP8bSearch(phrase);
        return { ok: true, ...probe };
      } catch (e: unknown) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : "Probe failed",
        };
      }
    },
  );
}

if (gotSingleInstanceLock) {
app.whenReady().then(async () => {
  console.info("[ripple-desktop] ===== build phase-p7-native =====");
  if (!process.env.OPENAI_API_KEY && !process.env.VITE_OPENAI_HINT) {
    console.warn(
      "[ripple-desktop] Desktop LLM planner uses backend OPENAI_API_KEY — set it on ripple-backend for AI fallback",
    );
  }
  initRippleDb();
  const { ensureP85ToolsRegistered } = await import(
    "../agent/planner/toolExecutorBridge.js"
  );
  ensureP85ToolsRegistered();
  console.info("[ripple-p85] P8.5 tools registered — voice testing ready");
  await initNativeHost();
  initNativeAppRegistry();
  startFileIndexBackground();
  startSemanticIndexBackfill();
  pruneActivityLogOlderThan(9);
  startMediaFocusWatcher();
  startFileIndexWatcher();
  startAppDiscoveryBackground();
  scanInstalledApps()
    .then((apps) => {
      mergeDiscoveredApps(apps);
      bootstrapDemoSeeds();
    })
    .catch(() => {
      bootstrapDemoSeeds();
    });
  console.info(
    "[ripple-desktop] Phase 4.7: Hindi/Urdu/Sinhala/Tamil NLU + local WhatsApp + LLM fallback",
  );
  console.info(
    "[ripple-desktop] WhatsApp: Chrome extension + Native Messaging - see WHATSAPP_SETUP.md",
  );
  startWhatsAppExtensionBridge();
  console.info(
    "[ripple-desktop] Voice pipeline: Whisper -> normalize -> match -> NLU -> act",
  );
  console.info(
    "[ripple-desktop] Phase 4 (active): desktop apps, aliases, file ops + Phase 3.5 web apps",
  );
  console.info(`[ripple-desktop] API base: ${API_BASE}`);
  console.info(`[ripple-desktop] Socket URL: ${getSocketUrl()}`);
  console.info(`[ripple-crash] crash logs → ${getCrashLogDir()}`);
  crashBreadcrumb("boot_complete", `pid=${process.pid}`);
  registerIpc();
  if (process.env.RIPPLE_OS_TEST === "1") {
    setConfirmHandlerForTests(async () => true);
  }
  startOsTestBridge(async (command) => {
    if (command === "__ripple_os_bridge_ping__") {
      return { ok: true, message: "pong", actionsOk: 0, actionsTotal: 0 };
    }
    // Wispr-Flow Phase 1 insert matrix: drive the real STT-skipped dictation
    // pipeline (correction → insert ladder) with canned text so the matrix
    // can be tested without a live microphone. Mirrors ipcMain "dictation:execute".
    if (
      command.startsWith("__ripple_dictate__::") ||
      command.startsWith("__ripple_dictate_continue__::")
    ) {
      const continueSession = command.startsWith(
        "__ripple_dictate_continue__::",
      );
      const prefix = continueSession
        ? "__ripple_dictate_continue__::"
        : "__ripple_dictate__::";
      const text = command.slice(prefix.length);
      const { executeDictationUtterance } = await import(
        "../agent/dictation/executeDictation.js"
      );
      if (!continueSession) {
        const { resetDictationSessionForTests } = await import(
          "../agent/dictation/dictationSession.js"
        );
        resetDictationSessionForTests();
      }
      const result = await executeDictationUtterance(text, { insert: true });
      return {
        ok: result.ok,
        message: result.ok
          ? result.finalText
          : `${result.error ?? "dictation_failed"} (finalText=${JSON.stringify(result.finalText)})`,
        actionsOk: result.inserted ? 1 : 0,
        actionsTotal: 1,
        tools: "dictation.insert",
        toolsList: ["dictation.insert"],
        plannerKind: "execute",
        intent: "dictation",
      };
    }
    const world = await buildWorldModel();
    const pipeline = await runPlannerPipelineAsync({
      command,
      world,
      getAccessToken: ensureValidAccessToken,
    });
    const toolsList =
      pipeline.kind === "execute" || pipeline.kind === "partial"
        ? pipeline.plan.steps.map((s) => s.tool)
        : [];
    const baseMeta = {
      tools: toolsList.join("→"),
      toolsList,
      plannerKind: pipeline.kind,
      blocked:
        pipeline.kind === "defer" &&
        /validation_failed|permission/i.test(
          pipeline.kind === "defer" ? pipeline.reason : "",
        ),
    };

    if (process.env.RIPPLE_OS_TEST_PLAN_ONLY === "1") {
      const planSteps =
        pipeline.kind === "execute" || pipeline.kind === "partial"
          ? pipeline.plan.steps.length
          : 0;
      return {
        ok: pipeline.kind === "execute" || pipeline.kind === "partial",
        message:
          pipeline.kind === "defer"
            ? pipeline.reason
            : pipeline.kind === "clarify"
              ? pipeline.question
              : "plan-only",
        actionsOk: 0,
        actionsTotal: planSteps,
        ...baseMeta,
      };
    }

    try {
      const result = await runDesktopCommand({
        command,
        getAccessToken: ensureValidAccessToken,
      });
      const exec = result.data?.execution as
        | { records?: Array<{ status: string; detail?: string }> }
        | undefined;
      const records = exec?.records ?? [];
      const actionsOk = records.filter((r) => r.status === "executed").length;
      const dragFromDetail = records.filter(
        (r) =>
          r.status === "executed" &&
          typeof r.detail === "string" &&
          /Drew\s+\w+\s+in\s+Paint/i.test(r.detail),
      ).length;
      const dragSteps =
        dragFromDetail > 0
          ? dragFromDetail
          : Math.max(0, Math.floor((actionsOk - 1) / 2));
      const msg = result.message ?? "";
      const blocked =
        baseMeta.blocked ||
        /blocked|not allowed|permission_blocked|bulk delete/i.test(msg);
      return {
        ok: result.ok,
        message: result.message,
        actionsOk,
        actionsTotal: records.length,
        dragSteps,
        intent: result.data?.intent,
        blocked,
        ...baseMeta,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        message: msg,
        actionsOk: 0,
        actionsTotal: 0,
        blocked: /blocked|not allowed|permission/i.test(msg),
        ...baseMeta,
      };
    }
  });
  createOverlayWindow();
  showBootStartingOverlay();
  const boot = await waitUntilVoiceInputReady();
  registerGlobalShortcuts();
  setVoiceInputReady(true);
  hideBootStartingOverlay();
  if (boot.ready) {
    console.info("[ripple-desktop] voice input armed — Shift+Space dictation");
  } else {
    console.warn(
      `[ripple-desktop] voice input armed with gaps — sidecar=${boot.sidecarOk} backend=${boot.backendOk}`,
    );
  }

  const loggedIn = await restoreAuth();
  const mainWin = createMainWindow();

  mainWin.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });

  createTray(() => {
    isQuitting = true;
    handleLogout().finally(() => app.quit());
  });

  if (!loggedIn) {
    mainWin.once("ready-to-show", () => {
      showMainWindow({ userInitiated: true });
    });
  } else if (process.env.ELECTRON_RENDERER_URL) {
    // Dev: you're logged in — still surface Home once so you don't hunt the
    // tray icon, but WITHOUT taking foreground.
    //
    // This used to call showMainWindow({ userInitiated: true }), which runs
    // setAlwaysOnTop → show → focus → moveTop: a hard foreground grab that
    // yanked the user's focused app (Cursor/Notepad/WhatsApp) on every dev
    // launch. That is the "my window goes off on the first dictation" report,
    // and it also caused the hotkey to pin Ripple's own window instead of the
    // app the user was in. showInactive() displays it without stealing focus.
    // Login (above) and tray/activate (below) intentionally still activate.
    mainWin.once("ready-to-show", () => {
      if (!mainWin.isDestroyed()) mainWin.showInactive();
    });
  }

  app.on("activate", () => {
    showMainWindow({ userInitiated: true });
  });
});
}

// --- crash / lifecycle visibility (desktop.md) ---------------------------
// These only observe + log. They never change quit behavior.
/**
 * Renderer crash auto-recovery.
 *
 * Captured live (crash-2026-08-18T18-07-43): the renderer died with
 * reason="crashed" exitCode=-1 at the same instant as the Chromium
 * "Audio Service" utility process — i.e. the first dictation opened the mic
 * and took the audio service (and the renderer with it) down. Electron does
 * NOT rebuild a crashed renderer, so the window went blank/dead and the app
 * looked closed with no way back. Reloading restores the UI and re-acquires
 * the mic. Bounded so a crash-loop cannot spin forever.
 */
const RENDERER_RELOAD_WINDOW_MS = 5 * 60 * 1000;
const RENDERER_RELOAD_MAX = 3;
let rendererReloads: number[] = [];

app.on("render-process-gone", (_e, wc, details) => {
  writeCrashLog("renderer.process_gone", new Error(`renderer gone: ${details.reason}`), {
    reason: details.reason,
    exitCode: details.exitCode,
  });
  if (isQuitting || details.reason === "clean-exit") return;

  const now = Date.now();
  rendererReloads = rendererReloads.filter((t) => now - t < RENDERER_RELOAD_WINDOW_MS);
  if (rendererReloads.length >= RENDERER_RELOAD_MAX) {
    crashBreadcrumb(
      "renderer_reload_giveup",
      `${rendererReloads.length} reloads within ${RENDERER_RELOAD_WINDOW_MS}ms`,
    );
    return;
  }
  rendererReloads.push(now);

  setTimeout(() => {
    try {
      if (wc.isDestroyed()) return;
      wc.reload();
      crashBreadcrumb("renderer_reloaded", `attempt=${rendererReloads.length}`);
      console.warn(
        `[ripple-crash] renderer crashed (${details.reason}) — reloaded (attempt ${rendererReloads.length}/${RENDERER_RELOAD_MAX})`,
      );
    } catch (e: unknown) {
      crashBreadcrumb(
        "renderer_reload_failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  }, 400);
});

app.on("child-process-gone", (_e, details) => {
  writeCrashLog("electron.child_process_gone", new Error(`child gone: ${details.type}`), {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    name: details.name,
    serviceName: details.serviceName,
  });
  // Chromium respawns utility processes on demand, but a dead Audio Service
  // leaves any in-flight mic capture broken. Surface it loudly; the renderer
  // handler above restores capture if the renderer went down with it.
  if (details.serviceName === "audio.mojom.AudioService" && !isQuitting) {
    console.warn(
      `[ripple-crash] Audio Service ${details.reason} (exit=${details.exitCode}) — mic capture must be restarted`,
    );
  }
});

app.on("quit", (_e, exitCode) => {
  crashBreadcrumb("app_quit", `exitCode=${exitCode}`);
});

app.on("before-quit", () => {
  crashBreadcrumb("app_before_quit", `isQuitting=${isQuitting}`);
  isQuitting = true;
  void endActiveSession();
});

app.on("will-quit", () => {
  crashBreadcrumb("app_will_quit");
  shutdownNativeHost();
  stopWhatsAppExtensionBridge();
  unregisterGlobalShortcuts();
  destroyTray();
  closeRippleDb();
});

app.on("window-all-closed", () => {
  // Stay in tray — do not quit when all windows are hidden
  crashBreadcrumb("window_all_closed", "staying in tray");
});
