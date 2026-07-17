import { createServer, type Server, type Socket } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { ingestCrossAppReference } from "../storage/crossAppIngest.js";
import type { CrossAppId } from "../storage/crossAppIngest.js";

export interface ExtensionResult {
  ok: boolean;
  error?: string;
  detail?: string;
}

interface Pending {
  resolve: (r: ExtensionResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Fixed local port — avoids random-port leaks on dev hot reload. */
const BRIDGE_PORT = Number(process.env.RIPPLE_NATIVE_BRIDGE_PORT ?? "39731");
const BRIDGE_HOST = "127.0.0.1";

let server: Server | null = null;
let nativeSocket: Socket | null = null;
let extensionReady = false;
let listenStarted = false;
let lastDisconnectLogAt = 0;
let readyLogged = false;
const pending = new Map<string, Pending>();

declare global {
  // eslint-disable-next-line no-var
  var __rippleNativeBridgePort: number | undefined;
}

function getRippleDir(): string {
  const base =
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? homedir(), "Ripple")
      : join(homedir(), ".ripple");
  mkdirSync(base, { recursive: true });
  return base;
}

function writePortFile(port: number): void {
  const file = join(getRippleDir(), "native-bridge.port");
  writeFileSync(file, String(port), "utf8");
  globalThis.__rippleNativeBridgePort = port;
}

function sendFrame(sock: Socket, obj: Record<string, unknown>): void {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  sock.write(Buffer.concat([header, json]));
}

let recvBuf = Buffer.alloc(0);

function onSocketData(chunk: Buffer): void {
  recvBuf = Buffer.concat([recvBuf, chunk]);
  while (recvBuf.length >= 4) {
    const len = recvBuf.readUInt32LE(0);
    if (recvBuf.length < 4 + len) return;
    const body = recvBuf.subarray(4, 4 + len);
    recvBuf = recvBuf.subarray(4 + len);
    let msg: {
      type?: string;
      id?: string;
      ok?: boolean;
      error?: string;
      detail?: string;
      logs?: string[];
    };
    try {
      msg = JSON.parse(body.toString("utf8"));
    } catch {
      continue;
    }

    if (msg.type === "NATIVE_HOST_READY" || msg.type === "HELLO") {
      extensionReady = true;
      if (!readyLogged) {
        readyLogged = true;
        console.info("[ripple-desktop] Native Messaging host connected");
      }
      continue;
    }

    if (msg.type === "CROSS_APP_INGEST_PUSH") {
      const ingest = msg as {
        appId?: string;
        summary?: string;
        path?: string;
        contact?: string;
        command?: string;
        externalUrl?: string;
        attachments?: string[];
      };
      const appId = ingest.appId?.trim().toLowerCase();
      const summary = ingest.summary?.trim();
      if (appId && summary) {
        const allowed = new Set([
          "gmail",
          "slack",
          "email",
          "whatsapp",
          "teams",
          "outlook",
        ]);
        if (allowed.has(appId)) {
          ingestCrossAppReference({
            appId: appId as CrossAppId,
            summary,
            path: ingest.path ?? null,
            contact: ingest.contact ?? null,
            command: ingest.command ?? null,
            externalUrl: ingest.externalUrl ?? null,
            attachments: Array.isArray(ingest.attachments)
              ? ingest.attachments
              : null,
          });
        }
      }
      continue;
    }

    if (msg.type === "INSTAGRAM_COMPOSER_RESULT" && msg.id) {
      const p = pending.get(msg.id);
      if (!p) continue;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      const compMsg = msg as { text?: string };
      p.resolve({
        ok: !!msg.ok,
        error: msg.error,
        detail: compMsg.text ?? "",
      });
      continue;
    }

    if (msg.type === "WHATSAPP_COMPOSER_RESULT" && msg.id) {
      const p = pending.get(msg.id);
      if (!p) continue;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      const compMsg = msg as { text?: string; detail?: string };
      const detail =
        (typeof compMsg.detail === "string" && compMsg.detail.trim()) ||
        (typeof compMsg.text === "string" && compMsg.text.trim()) ||
        "";
      p.resolve({
        ok: !!msg.ok,
        error: msg.error,
        detail,
      });
      continue;
    }

    if (msg.type === "ACTIVE_TAB_RESULT" && msg.id) {
      const p = pending.get(msg.id);
      if (!p) continue;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      const tabMsg = msg as { url?: string; title?: string };
      p.resolve({
        ok: !!msg.ok,
        error: msg.error,
        detail: JSON.stringify({
          url: tabMsg.url ?? "",
          title: tabMsg.title ?? "",
        }),
      });
      continue;
    }

    if (msg.type === "BROWSER_GENERIC_RESULT" && msg.id) {
      const p = pending.get(msg.id);
      if (!p) continue;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve({
        ok: !!msg.ok,
        error: msg.error,
        detail: msg.detail,
      });
      continue;
    }

    if (
      (msg.type === "WHATSAPP_RESULT" ||
        msg.type === "YOUTUBE_RESULT" ||
        msg.type === "LINKEDIN_RESULT" ||
        msg.type === "INSTAGRAM_RESULT") &&
      msg.id
    ) {
      const p = pending.get(msg.id);
      if (!p) continue;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      if (msg.type === "WHATSAPP_RESULT" && Array.isArray(msg.logs)) {
        for (const line of msg.logs) {
          console.info(`[ripple-wa] ${line}`);
        }
      }
      p.resolve({
        ok: !!msg.ok,
        error: msg.error,
        detail: msg.detail,
      });
    }
  }
}

function attachClient(sock: Socket): void {
  nativeSocket = sock;
  extensionReady = false;
  recvBuf = Buffer.alloc(0);

  sock.on("data", onSocketData);
  sock.on("close", () => {
    if (nativeSocket === sock) {
      nativeSocket = null;
      extensionReady = false;
      readyLogged = false;
    }
    const now = Date.now();
    if (now - lastDisconnectLogAt > 8000) {
      lastDisconnectLogAt = now;
      console.warn("[ripple-desktop] Native Messaging host disconnected");
    }
  });
  sock.on("error", () => {
    if (nativeSocket === sock) {
      nativeSocket = null;
      extensionReady = false;
    }
  });
}

export function startNativeMessagingBridge(): void {
  if (listenStarted && server?.listening) {
    writePortFile(BRIDGE_PORT);
    return;
  }

  stopNativeMessagingBridge();

  server = createServer((sock) => {
    if (nativeSocket?.writable) {
      sock.destroy();
      return;
    }
    attachClient(sock);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    listenStarted = false;
    if (err.code === "EADDRINUSE") {
      writePortFile(BRIDGE_PORT);
      console.warn(
        `[ripple-desktop] Native bridge port ${BRIDGE_PORT} already in use — close other Ripple/Electron windows and restart`,
      );
      return;
    }
    if (err.code === "ENOBUFS" || err.code === "ENOMEM") {
      console.error(
        "[ripple-desktop] ENOBUFS: too many sockets. Run: Get-Process node,electron | Stop-Process -Force — then npm run dev once",
      );
      return;
    }
    console.error("[ripple-desktop] Native bridge listen failed:", err.message);
  });

  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    listenStarted = true;
    writePortFile(BRIDGE_PORT);
    console.info(
      `[ripple-desktop] Native Messaging bridge on ${BRIDGE_HOST}:${BRIDGE_PORT} (port file in %LOCALAPPDATA%\\Ripple)`,
    );
  });
}

export function isNativeMessagingConnected(): boolean {
  return extensionReady && nativeSocket?.writable === true;
}

export interface ExtensionActiveTab {
  url: string;
  title: string;
}

/** Active Chrome tab URL/title from extension (when window title is empty). */
export function queryActiveTabFromExtension(): Promise<ExtensionActiveTab | null> {
  return new Promise((resolve) => {
    if (!isNativeMessagingConnected()) {
      resolve(null);
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 4000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok || !r.detail) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(r.detail) as { url?: string; title?: string };
          resolve({
            url: parsed.url ?? "",
            title: parsed.title ?? "",
          });
        } catch {
          resolve(null);
        }
      },
      reject: () => resolve(null),
      timer,
    });

    sendFrame(nativeSocket!, { type: "GET_ACTIVE_TAB_INFO", id });
  });
}

export type BrowserGenericExtensionPayload = {
  action: string;
  selector?: string;
  text?: string;
  ariaLabel?: string;
  partial?: boolean;
  x?: number;
  y?: number;
  deltaY?: number;
  amount?: number;
  maxChars?: number;
};

/** P5.3 — generic DOM action in the user's active Chrome tab. */
export function runBrowserGenericViaExtension(
  payload: BrowserGenericExtensionPayload,
): Promise<ExtensionResult> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(new Error("Native Messaging not connected"));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Browser generic action timed out (20s)"));
    }, 20_000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "browser_generic_failed"));
          return;
        }
        resolve(r);
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, { type: "BROWSER_GENERIC", id, ...payload });
  });
}

/** Read text currently in the Instagram DM composer (for rephrase/tone). */
export function queryInstagramComposerFromExtension(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isNativeMessagingConnected()) {
      resolve(null);
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 5000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok || !r.detail?.trim()) {
          resolve(null);
          return;
        }
        resolve(r.detail.trim());
      },
      reject: () => resolve(null),
      timer,
    });

    sendFrame(nativeSocket!, { type: "INSTAGRAM_READ_COMPOSER", id });
  });
}

/** Read text currently in the WhatsApp message composer (for rephrase/tone). */
export function queryWhatsAppComposerFromExtension(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isNativeMessagingConnected()) {
      resolve(null);
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, 5000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok || !r.detail?.trim()) {
          resolve(null);
          return;
        }
        resolve(r.detail.trim());
      },
      reject: () => resolve(null),
      timer,
    });

    sendFrame(nativeSocket!, { type: "WHATSAPP_READ_COMPOSER", id });
  });
}

/** Replace all text in the open WhatsApp composer (rephrase/tone). */
export function replaceWhatsAppComposerViaExtension(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(new Error("Native Messaging not connected"));
      return;
    }

    const body = text.trim();
    if (!body) {
      reject(new Error("WhatsApp rephrase text is empty"));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("WhatsApp composer replace timed out (15s)"));
    }, 15_000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "WhatsApp composer replace failed"));
          return;
        }
        const detail = r.detail?.trim();
        resolve(
          detail || `Updated WhatsApp message (${body.length} chars)`,
        );
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, { type: "WHATSAPP_REPLACE_COMPOSER", id, text: body });
  });
}

export function runWhatsAppViaNativeMessaging(args: {
  contact: string;
  text: string;
  send: boolean;
  attachment?: {
    fileName: string;
    mimeType: string;
    base64: string;
  };
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(
        new Error(
          "Native Messaging not connected. Install extension + run native-host/install-windows.ps1 -ExtensionId <ID from chrome://extensions> (see WHATSAPP_SETUP.md).",
        ),
      );
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("WhatsApp Native Messaging timed out (60s)"));
    }, 60_000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "WhatsApp failed"));
          return;
        }
        resolve(r.detail ?? `WhatsApp: done for ${args.contact}`);
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, {
      type: "WHATSAPP_RUN",
      id,
      contact: args.contact,
      text: args.text,
      send: args.send,
      attachment: args.attachment,
    });
  });
}

export function runYouTubeViaNativeMessaging(args: {
  query: string;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(
        new Error(
          "Native Messaging not connected. Install extension + run native-host/install-windows.ps1 -ExtensionId <ID from chrome://extensions>.",
        ),
      );
      return;
    }

    const q = args.query.trim();
    if (!q) {
      reject(new Error("YouTube query is empty"));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("YouTube auto-play timed out (40s) — reload extension at chrome://extensions"));
    }, 40_000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "YouTube auto-play failed"));
          return;
        }
        resolve(r.detail ?? "YouTube: clicked best result");
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, {
      type: "YOUTUBE_PLAY",
      id,
      query: q,
    });
  });
}

export function runLinkedInViaNativeMessaging(args: {
  text: string;
  publish: boolean;
  pasteOnly?: boolean;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(
        new Error(
          "Native Messaging not connected. Install extension + run native-host/install-windows.ps1.",
        ),
      );
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("LinkedIn composer timed out (60s) — reload extension at chrome://extensions"));
    }, 60_000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "LinkedIn post failed"));
          return;
        }
        resolve(r.detail ?? "LinkedIn: post drafted");
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, {
      type: "LINKEDIN_CREATE_POST",
      id,
      text: args.text.trim(),
      publish: !!args.publish,
      pasteOnly: args.pasteOnly === true,
    });
  });
}

export function runInstagramViaNativeMessaging(args: {
  username: string;
  text: string;
  send: boolean;
  pasteOnly?: boolean;
  sendOnly?: boolean;
  navigateOnly?: boolean;
  focusComposer?: boolean;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(
        new Error(
          "Native Messaging not connected. Install extension + run native-host/install-windows.ps1.",
        ),
      );
      return;
    }

    const user = args.username.trim().replace(/^@/, "");
    const text = args.text.trim();
    const pasteOnly = args.pasteOnly === true;
    const sendOnly = args.sendOnly === true;
    const navigateOnly = args.navigateOnly === true;
    const focusComposer = args.focusComposer === true;

    if (sendOnly || focusComposer) {
      /* ok — no text required */
    } else if (navigateOnly) {
      if (!user) {
        reject(new Error("Instagram recipient name missing"));
        return;
      }
    } else if (!text || (!pasteOnly && !user)) {
      reject(new Error("Instagram username or message is empty"));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Instagram DM timed out (60s) — reload extension at chrome://extensions"));
    }, 60_000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "Instagram message failed"));
          return;
        }
        resolve(r.detail ?? `Instagram: message to ${user}`);
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, {
      type: "INSTAGRAM_MESSAGE",
      id,
      username: user,
      text,
      send: !!args.send,
      pasteOnly,
      sendOnly,
      navigateOnly,
      focusComposer,
    });
  });
}

/** Click the Instagram DM composer so desktop Ctrl+A paste hits the right field. */
export function focusInstagramComposerViaExtension(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isNativeMessagingConnected()) {
      reject(new Error("Native Messaging not connected"));
      return;
    }

    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Instagram focus composer timed out (8s)"));
    }, 8000);

    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) {
          reject(new Error(r.error ?? "Could not focus Instagram composer"));
          return;
        }
        resolve(r.detail ?? "Composer focused");
      },
      reject,
      timer,
    });

    sendFrame(nativeSocket!, { type: "INSTAGRAM_FOCUS_COMPOSER", id });
  });
}

export function stopNativeMessagingBridge(): void {
  listenStarted = false;
  extensionReady = false;
  readyLogged = false;
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(new Error("Native Messaging bridge stopped"));
  }
  pending.clear();

  try {
    nativeSocket?.destroy();
  } catch {
    /* ignore */
  }
  nativeSocket = null;

  if (server) {
    try {
      server.close();
    } catch {
      /* ignore */
    }
    server = null;
  }
}
