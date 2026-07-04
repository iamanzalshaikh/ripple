import net from "node:net";
import { randomUUID } from "node:crypto";
import type { NativeSessionInfo, RpcResponse, SidecarCapabilityFlags } from "./nativePipeFraming.js";
import {
  encodePipeFrame,
  PipeFrameReader,
} from "./nativePipeFraming.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type NativeHotkeyEvent = {
  event: "hotkey";
  name: string;
};

export type NativeForegroundEvent = {
  event: "foreground_changed";
  hwnd: number;
  processName: string;
  windowTitle: string;
};

export type NativePushEvent = NativeHotkeyEvent | NativeForegroundEvent;

type NativeEventListener = (event: NativePushEvent) => void;

let socket: net.Socket | null = null;
let reader = new PipeFrameReader();
let authenticated = false;
let capabilities: SidecarCapabilityFlags | null = null;
const pending = new Map<string, Pending>();
const eventListeners = new Set<NativeEventListener>();
const DEFAULT_RPC_TIMEOUT_MS = 8000;

function rejectAllPending(err: Error): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

export function onNativeEvent(listener: NativeEventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

function dispatchNativeEvent(event: NativePushEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (e: unknown) {
      console.warn(
        "[ripple-native] event listener error:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

function handleIncoming(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const msg = raw as RpcResponse & { method?: string; name?: string };

  if (msg.event === "hotkey" && typeof msg.name === "string") {
    console.info(`[ripple-native] event: hotkey name=${msg.name}`);
    dispatchNativeEvent({ event: "hotkey", name: msg.name });
    return;
  }

  if (
    msg.event === "foreground_changed" &&
    typeof msg.hwnd === "number" &&
    typeof (msg as { processName?: string }).processName === "string" &&
    typeof (msg as { windowTitle?: string }).windowTitle === "string"
  ) {
    const fg = msg as NativeForegroundEvent;
    dispatchNativeEvent({
      event: "foreground_changed",
      hwnd: fg.hwnd,
      processName: fg.processName,
      windowTitle: fg.windowTitle,
    });
    return;
  }

  const id = msg.id;
  if (!id) return;

  const p = pending.get(id);
  if (!p) return;

  clearTimeout(p.timer);
  pending.delete(id);

  if (!msg.ok) {
    p.reject(new Error(msg.error ?? "native_rpc_failed"));
    return;
  }
  p.resolve(msg.result);
}

function attachSocket(sock: net.Socket): void {
  sock.on("data", (chunk) => {
    try {
      const frames = reader.push(chunk);
      for (const frame of frames) {
        handleIncoming(frame);
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn("[ripple-native] frame parse error:", err.message);
      disconnectNativeClient();
    }
  });

  sock.on("error", (err) => {
    console.warn("[ripple-native] pipe error:", err.message);
    disconnectNativeClient();
  });

  sock.on("close", () => {
    console.info("[ripple-native] pipe closed");
    disconnectNativeClient();
  });
}

export function isNativeClientAuthenticated(): boolean {
  return authenticated && socket !== null && !socket.destroyed;
}

export function getSidecarCapabilities(): SidecarCapabilityFlags | null {
  return capabilities;
}

export async function connectNativeClient(
  session: NativeSessionInfo,
): Promise<boolean> {
  if (process.platform !== "win32") return false;

  disconnectNativeClient();

  return new Promise((resolve) => {
    const sock = net.connect(session.pipe);
    socket = sock;
    reader = new PipeFrameReader();
    authenticated = false;
    capabilities = null;

    const fail = (reason: string) => {
      console.warn(`[ripple-native] connect failed: ${reason}`);
      disconnectNativeClient();
      resolve(false);
    };

    sock.once("error", (err) => fail(err.message));

    sock.once("connect", async () => {
      attachSocket(sock);
      try {
        const auth = (await callNativeRpc("auth", {
          token: session.token,
        })) as {
          version?: string;
          protocol?: number;
          capabilities?: SidecarCapabilityFlags;
        };

        if (typeof auth?.protocol === "number" && auth.protocol !== 1) {
          fail(`unsupported protocol ${auth.protocol}`);
          return;
        }

        authenticated = true;
        capabilities = auth?.capabilities ?? null;

        if (!capabilities) {
          capabilities = (await callNativeRpc(
            "get_capabilities",
            {},
          )) as SidecarCapabilityFlags;
        }

        console.info(
          `[ripple-native] sidecar connected — protocol=${capabilities?.protocol ?? auth?.protocol ?? "?"} version=${capabilities?.version ?? auth?.version ?? "?"} globalHotkey=${capabilities?.globalHotkey === true} foregroundEvents=${capabilities?.foregroundEvents === true} sendInput=${capabilities?.sendInput === true} uia=${capabilities?.uia === true}`,
        );
        resolve(true);
      } catch (e: unknown) {
        fail(e instanceof Error ? e.message : String(e));
      }
    });
  });
}

export function disconnectNativeClient(): void {
  authenticated = false;
  capabilities = null;
  rejectAllPending(new Error("native_client_disconnected"));
  reader.reset();

  if (socket) {
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
    socket = null;
  }
}

export function callNativeRpc(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
): Promise<unknown> {
  if (!socket || socket.destroyed) {
    return Promise.reject(new Error("native_client_not_connected"));
  }

  const id = randomUUID();
  const payload = { id, method, params };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`native_rpc_timeout:${method}`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });

    try {
      socket!.write(encodePipeFrame(payload));
    } catch (e: unknown) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function pingNativeSidecar(
  timeoutMs = 2000,
): Promise<boolean> {
  if (!isNativeClientAuthenticated()) return false;
  try {
    await callNativeRpc("ping", {}, timeoutMs);
    return true;
  } catch {
    return false;
  }
}
