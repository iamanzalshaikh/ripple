import { app, ipcMain } from "electron";
import { loadDesktopEnv, getSocketUrl } from "../config/env.js";
import { logPhaseBBootLine } from "../agent/planner/phaseBConfig.js";
import { logPlannerV2BootLine } from "../agent/planner/v2/plannerV2Config.js";
import { API_BASE } from "../services/api.js";
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
  logTranscriptStage,
  processTranscriptFromStt,
  transcriptDebugLabel,
} from "../automation/voice/transcriptPipeline.js";
import { setLastVoiceCommand } from "../state/lastCommand.js";
import {
  setVoiceSessionActive,
  setOverlayState,
} from "../windows/overlay.js";

loadDesktopEnv();
logPhaseBBootLine();
logPlannerV2BootLine();
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
import { createOverlayWindow } from "../windows/overlay.js";
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
    showMainWindow();
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
  return { ok: true, user: currentUser, sessionId };
}

function registerIpc(): void {
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

  ipcMain.handle(
    "voice:end",
    async (_e, args: { streamId: string; sessionId?: string }) => {
      try {
        const data = await rippleSocket.endVoice(
          args.streamId,
          args.sessionId ?? sessionId ?? undefined,
        );
        const payload = data as { text?: string; language?: string };
        const text = payload?.text;
        if (text) {
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
          if (snapshot.wasMojibake) {
            console.info(
              `[ripple-desktop] voice transcript repaired → ${transcriptDebugLabel(snapshot.normalized)}`,
            );
          }
        }
        return { ok: true, data };
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
    });
  });

  ipcMain.handle("command:execute", (_e, args) => {
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
    if (!active) setOverlayState("idle");
    return { ok: true };
  });

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
  registerIpc();
  if (process.env.RIPPLE_OS_TEST === "1") {
    setConfirmHandlerForTests(async () => true);
  }
  startOsTestBridge(async (command) => {
    if (command === "__ripple_os_bridge_ping__") {
      return { ok: true, message: "pong", actionsOk: 0, actionsTotal: 0 };
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

  registerGlobalShortcuts();

  if (!loggedIn) {
    showMainWindow();
  }

  app.on("activate", () => {
    showMainWindow();
  });
});
}

app.on("before-quit", () => {
  isQuitting = true;
  void endActiveSession();
});

app.on("will-quit", () => {
  shutdownNativeHost();
  stopWhatsAppExtensionBridge();
  unregisterGlobalShortcuts();
  destroyTray();
  closeRippleDb();
});

app.on("window-all-closed", () => {
  // Stay in tray — do not quit when all windows are hidden
});
