/**
 * Chrome Native Messaging host — bridges Chrome extension (stdio) ↔ Ripple Electron (TCP).
 */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";

const portFile = path.join(
  process.env.LOCALAPPDATA || process.env.HOME || "",
  "Ripple",
  "native-bridge.port",
);

let electron = null;
let chromeBuf = Buffer.alloc(0);
let electronBuf = Buffer.alloc(0);
let reconnectDelayMs = 2000;
let reconnectTimer = null;
const MAX_RECONNECT_MS = 30_000;

function writeChromeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

function sendElectron(obj) {
  if (!electron?.writable) return;
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  electron.write(Buffer.concat([header, json]));
}

function pumpChrome() {
  while (chromeBuf.length >= 4) {
    const len = chromeBuf.readUInt32LE(0);
    if (chromeBuf.length < 4 + len) return;
    const body = chromeBuf.subarray(4, 4 + len);
    chromeBuf = chromeBuf.subarray(4 + len);
    try {
      sendElectron(JSON.parse(body.toString("utf8")));
    } catch {
      /* ignore */
    }
  }
}

function pumpElectron() {
  while (electronBuf.length >= 4) {
    const len = electronBuf.readUInt32LE(0);
    if (electronBuf.length < 4 + len) return;
    const body = electronBuf.subarray(4, 4 + len);
    electronBuf = electronBuf.subarray(4 + len);
    try {
      writeChromeMessage(JSON.parse(body.toString("utf8")));
    } catch {
      /* ignore */
    }
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectElectron();
  }, reconnectDelayMs);
  reconnectDelayMs = Math.min(Math.round(reconnectDelayMs * 1.5), MAX_RECONNECT_MS);
}

function connectElectron() {
  if (electron?.writable) return;

  if (!fs.existsSync(portFile)) {
    scheduleReconnect();
    return;
  }
  const port = Number.parseInt(fs.readFileSync(portFile, "utf8"), 10);
  if (!port) {
    scheduleReconnect();
    return;
  }

  let sentReady = false;
  const sock = net.connect({ host: "127.0.0.1", port }, () => {
    reconnectDelayMs = 2000;
    electron = sock;
    if (!sentReady) {
      sentReady = true;
      sendElectron({ type: "NATIVE_HOST_READY" });
    }
  });

  sock.on("data", (chunk) => {
    electronBuf = Buffer.concat([electronBuf, chunk]);
    pumpElectron();
  });
  sock.on("close", () => {
    if (electron === sock) electron = null;
    scheduleReconnect();
  });
  sock.on("error", () => {
    if (electron === sock) electron = null;
    try {
      sock.destroy();
    } catch {
      /* ignore */
    }
    scheduleReconnect();
  });
}

process.stdin.on("data", (chunk) => {
  chromeBuf = Buffer.concat([chromeBuf, chunk]);
  pumpChrome();
});
process.stdin.on("end", () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try {
    electron?.destroy();
  } catch {
    /* ignore */
  }
  process.exit(0);
});

connectElectron();
