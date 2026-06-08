import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const BRIDGE_PORT = Number(process.env.RIPPLE_BRIDGE_PORT ?? "9333");

export const WS_NOT_CONNECTED =
  "WebSocket bridge not connected (dev fallback only).";

interface Pending {
  resolve: (r: { ok: boolean; error?: string; detail?: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let wss: WebSocketServer | null = null;
let client: WebSocket | null = null;
const pending = new Map<string, Pending>();

export function startWebSocketBridge(): void {
  if (wss) return;
  wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT });
  wss.on("connection", (ws: WebSocket) => {
    client = ws;
    ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: { type?: string; id?: string; ok?: boolean; error?: string; detail?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "WHATSAPP_RESULT" && msg.id) {
        const p = pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(msg.id);
        p.resolve({ ok: !!msg.ok, error: msg.error, detail: msg.detail });
      }
    });
    ws.on("close", () => {
      if (client === ws) client = null;
    });
  });
}

export function isWebSocketBridgeConnected(): boolean {
  return client?.readyState === 1;
}

export function runWhatsAppViaWebSocket(args: {
  contact: string;
  text: string;
  send: boolean;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!client) {
      reject(new Error(WS_NOT_CONNECTED));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("WebSocket timeout"));
    }, 60_000);
    pending.set(id, {
      resolve: (r) => {
        if (!r.ok) reject(new Error(r.error ?? "failed"));
        else resolve(r.detail ?? "ok");
      },
      reject,
      timer,
    });
    client.send(JSON.stringify({ type: "WHATSAPP_RUN", id, ...args }));
  });
}
