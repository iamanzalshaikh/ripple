/**
 * P7d manual test — types "Ripple P7d OK" into the current foreground window via sidecar SendInput.
 *
 * Usage (standalone — stop npm run dev first, only one pipe client allowed):
 *   1. npm run native:build
 *   2. Open Notepad, click inside it
 *   3. ripple-native\target\release\ripple-native.exe   (in another terminal)
 *   4. node scripts/test-p7d-sendinput.mjs
 *
 * If npm run dev is running, Electron owns the pipe — test typing via voice instead.
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
              "already_connected — npm run dev (Electron) owns the sidecar pipe. Stop dev first, or test via voice in Ripple.",
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
  console.log("Foreground:", fg);

  console.log('Sending text "Ripple P7d OK" in 2s — focus Notepad now...');
  await new Promise((r) => setTimeout(r, 2000));

  const result = await rpc(sock, "send_keys", {
    text: "Ripple P7d OK",
    hwnd: fg?.hwnd,
    titleHint: fg?.windowTitle,
    delayMs: 100,
  });

  console.log("send_keys result:", result);
  sock.destroy();
  console.log("Done — check Notepad for typed text.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
