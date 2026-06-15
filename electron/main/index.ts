import { app, ipcMain } from "electron";
import { loadDesktopEnv, getSocketUrl } from "../config/env.js";
import { API_BASE } from "../services/api.js";
import { rippleSocket } from "../socket/rippleSocket.js";
import { runDesktopCommand } from "../services/commandOrchestrator.js";
import { buildContextMetadata } from "../automation/appDetector/contextBuilder.js";
import { readInstagramComposerText } from "../automation/adapters/instagram/readComposer.js";
import { isEditOrRephraseCommand } from "../automation/commandIntent.js";
import { isInstagramTabActive } from "../focus/focusContext.js";
import { extractRephraseSourceText } from "../automation/rephraseParse.js";
import { normalizeTranscript } from "../automation/voice/normalizeTranscript.js";
import { setLastVoiceCommand } from "../state/lastCommand.js";
import {
  setVoiceSessionActive,
  setOverlayState,
} from "../windows/overlay.js";

loadDesktopEnv();
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
import {
  startWhatsAppExtensionBridge,
  stopWhatsAppExtensionBridge,
} from "../bridge/whatsappExtensionBridge.js";
import { initRippleDb, closeRippleDb } from "../storage/rippleDb.js";
import { listDesktopHistory } from "../storage/desktopHistory.js";

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
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
  ipcMain.handle("api:health", async () => {
    const result = await apiHealthCheck();
    logApi("GET", "/health", result.ok, result.message);
    return result;
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
        const text = (data as { text?: string })?.text;
        if (text) {
          console.info(`[ripple-desktop] voice transcript: "${text}"`);
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

  ipcMain.handle("command:execute", async (_e, args) => {
    const cmd = normalizeTranscript(args.command);
    setLastVoiceCommand(cmd);
    const preview = cmd.length > 200 ? `${cmd.slice(0, 200)}…` : cmd;
    console.info(
      `[ripple-desktop] command:execute (${cmd.length} chars): "${preview}"`,
    );
    const contextMetadata = {
      ...(await buildContextMetadata()),
      ...args.contextMetadata,
    };
    let selectedText = extractRephraseSourceText(cmd) ?? undefined;
    if (!selectedText && isInstagramTabActive() && isEditOrRephraseCommand(cmd)) {
      const fromComposer = await readInstagramComposerText();
      if (fromComposer?.trim()) {
        selectedText = fromComposer.trim();
        console.info(
          `[ripple-desktop] DM rephrase — ${selectedText.length} chars from open composer`,
        );
      }
    }
    return runDesktopCommand({
      command: cmd,
      sessionId: args.sessionId ?? sessionId,
      contextMetadata,
      selectedText,
      getAccessToken: ensureValidAccessToken,
    });
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

  ipcMain.handle("overlay:voice-active", (_e, active: boolean) => {
    setVoiceSessionActive(active);
    if (!active) setOverlayState("idle");
    return { ok: true };
  });
}

if (gotSingleInstanceLock) {
app.whenReady().then(async () => {
  console.info("[ripple-desktop] ===== build phase-4.0-desktop-intelligence-v1 =====");
  initRippleDb();
  console.info(
    "[ripple-desktop] WhatsApp: Chrome extension + Native Messaging - see WHATSAPP_SETUP.md",
  );
  startWhatsAppExtensionBridge();
  console.info(
    "[ripple-desktop] Voice pipeline: Whisper -> normalize -> match -> confidence -> confirm -> act",
  );
  console.info(
    "[ripple-desktop] Phase 4 (active): desktop apps, aliases, file ops + Phase 3.5 web apps",
  );
  console.info(`[ripple-desktop] API base: ${API_BASE}`);
  console.info(`[ripple-desktop] Socket URL: ${getSocketUrl()}`);
  registerIpc();
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
  stopWhatsAppExtensionBridge();
  unregisterGlobalShortcuts();
  destroyTray();
  closeRippleDb();
});

app.on("window-all-closed", () => {
  // Stay in tray — do not quit when all windows are hidden
});
