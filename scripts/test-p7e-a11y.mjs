/**
 * P7e manual test — reads the focused UI Automation element via sidecar COM/UIA.
 *
 * Usage (standalone — stop npm run dev first, only one pipe client allowed):
 *   1. npm run native:build
 *   2. Start sidecar only: ripple-native\target\release\ripple-native.exe
 *   3. node scripts/test-p7e-a11y.mjs
 *
 * If npm run dev is running, Electron owns the pipe — use voice/hotkeys instead.
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
              "already_connected — npm run dev (Electron) owns the sidecar pipe. Stop dev first, or test via voice/Ctrl+Space in Ripple.",
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
  const caps = auth.capabilities ?? auth;
  console.log("Capabilities:", caps);

  if (!caps.uia) {
    console.error("Sidecar reports uia=false — rebuild: npm run native:build");
    process.exit(1);
  }

  console.log("Reading focused a11y element in 2s — click a text field now...");
  await new Promise((r) => setTimeout(r, 2000));

  const fg = await rpc(sock, "get_foreground");
  console.log("Foreground window:", fg);

  const t0 = performance.now();
  const el = await rpc(sock, "get_focused_a11y");
  const ms = Math.round(performance.now() - t0);

  console.log(`Focused element (${ms}ms):`);
  console.log(JSON.stringify(el, null, 2));
  sock.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
