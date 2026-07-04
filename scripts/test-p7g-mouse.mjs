/**
 * P7g — smoke test mouse + window RPCs against ripple-native sidecar.
 *
 * Usage (standalone — stop npm run dev first; only one pipe client allowed):
 *   1. npm run native:build
 *   2. ripple-native\target\release\ripple-native.exe   (in another terminal)
 *   3. npm run native:test-mouse
 *
 * If npm run dev is running, Electron owns the pipe — test mouse via voice instead:
 *   "Move mouse down", "Click here", "Double click"
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";

const sessionPath = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "Ripple",
  "ripple-native.session",
);

function encodeFrame(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function readFrames(buffer) {
  const frames = [];
  let buf = buffer;
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    frames.push(JSON.parse(buf.subarray(4, 4 + len).toString("utf8")));
    buf = buf.subarray(4 + len);
  }
  return { frames, rest: buf };
}

async function rpc(sock, method, params = {}) {
  const id = randomUUID();
  sock.write(encodeFrame({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), 10_000);
    const onData = (chunk) => {
      onData.buffer = Buffer.concat([onData.buffer ?? Buffer.alloc(0), chunk]);
      const { frames, rest } = readFrames(onData.buffer);
      onData.buffer = rest;
      for (const frame of frames) {
        if (frame.error === "already_connected") {
          clearTimeout(timer);
          sock.off("data", onData);
          reject(
            new Error(
              "already_connected — npm run dev (Electron) owns the sidecar pipe. Stop dev first, or test via voice: Move mouse down / Click here.",
            ),
          );
          return;
        }
        if (frame.id === id) {
          clearTimeout(timer);
          sock.off("data", onData);
          if (!frame.ok) reject(new Error(frame.error ?? "rpc_failed"));
          else resolve(frame.result);
        }
      }
    };
    onData.buffer = Buffer.alloc(0);
    sock.on("data", onData);
  });
}

async function main() {
  if (process.platform !== "win32") {
    console.error("Windows only");
    process.exit(1);
  }
  if (!existsSync(sessionPath)) {
    console.error(`No session file — start Ripple dev first: ${sessionPath}`);
    process.exit(1);
  }

  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  console.log(`Connecting to ${session.pipe} (pid ${session.pid})...`);

  const sock = await new Promise((resolve, reject) => {
    const s = net.connect(session.pipe);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  });

  const auth = await rpc(sock, "auth", { token: session.token });
  console.log("Auth OK — capabilities:", auth.capabilities ?? auth);

  const fg = await rpc(sock, "get_foreground");
  console.log("foreground:", fg);

  if (fg?.hwnd) {
    const focus = await rpc(sock, "focus_window", {
      hwnd: fg.hwnd,
      titleHint: fg.windowTitle,
    });
    console.log("focus_window:", focus);
  }

  const click = await rpc(sock, "mouse_click", { x: 200, y: 200, button: "left" });
  console.log("mouse_click:", click);

  const scroll = await rpc(sock, "mouse_scroll", { x: 400, y: 400, delta: -120 });
  console.log("mouse_scroll:", scroll);

  const cursor = await rpc(sock, "get_cursor_position");
  console.log("get_cursor_position:", cursor);

  if (cursor?.x != null) {
    const moved = await rpc(sock, "mouse_move", {
      x: cursor.x + 40,
      y: cursor.y,
    });
    console.log("mouse_move:", moved);
  }

  const drag = await rpc(sock, "mouse_drag", {
    fromX: 300,
    fromY: 300,
    toX: 500,
    toY: 400,
    button: "left",
  });
  console.log("mouse_drag:", drag);

  sock.destroy();
  console.log("P7g mouse/window RPC smoke test done.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
