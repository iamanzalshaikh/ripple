export type NativeSessionInfo = {
  pipe: string;
  token: string;
  pid: number;
};

export type SidecarCapabilityFlags = {
  platform: string;
  protocol: number;
  version: string;
  sendInput: boolean;
  uia: boolean;
  ocr: boolean;
  globalHotkey: boolean;
  elevationInjection: boolean;
  foregroundEvents: boolean;
  mouse?: boolean;
  windowOps?: boolean;
};

export type RpcResponse = {
  id?: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  event?: string;
  name?: string;
  hwnd?: number;
  processName?: string;
  windowTitle?: string;
};

export function encodePipeFrame(payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export class PipeFrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: unknown[] = [];
    for (;;) {
      if (this.buffer.length < 4) break;
      const len = this.buffer.readUInt32LE(0);
      if (len === 0 || len > 8 * 1024 * 1024) {
        throw new Error(`invalid pipe frame length: ${len}`);
      }
      if (this.buffer.length < 4 + len) break;
      const body = this.buffer.subarray(4, 4 + len);
      this.buffer = this.buffer.subarray(4 + len);
      frames.push(JSON.parse(body.toString("utf8")));
    }
    return frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
