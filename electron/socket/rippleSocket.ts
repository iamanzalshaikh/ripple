import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import { io, type Socket } from "socket.io-client";
import { getSocketUrl } from "../config/env.js";

export type SocketStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface VoiceChunkInput {
  streamId?: string;
  sessionId?: string;
  chunk: Buffer;
  mimeType?: string;
  filename?: string;
  isFinal?: boolean;
}

export interface CommandExecuteInput {
  sessionId?: string;
  command: string;
  contextType?: string;
  actionSource?: string;
  contextMetadata?: Record<string, unknown>;
  selectedText?: string | null;
}

type SocketAck = Record<string, unknown>;

class RippleSocketManager {
  private socket: Socket | null = null;
  private status: SocketStatus = "disconnected";
  private token: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly backoffMs = [2000, 5000, 10000];

  getStatus(): SocketStatus {
    return this.status;
  }

  isConnected(): boolean {
    return Boolean(this.socket?.connected);
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    }
  }

  private emitStatus(extra?: Record<string, unknown>): void {
    this.broadcast("socket:status", {
      status: this.status,
      connected: this.isConnected(),
      ...extra,
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.token) return;
    this.clearReconnectTimer();
    const delay =
      this.backoffMs[
        Math.min(this.reconnectAttempts, this.backoffMs.length - 1)
      ] ?? 10000;
    this.reconnectAttempts += 1;
    this.status = "reconnecting";
    this.emitStatus({ attempt: this.reconnectAttempts, retryInMs: delay });

    this.reconnectTimer = setTimeout(() => {
      if (this.token) void this.connect(this.token);
    }, delay);
  }

  private attachSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this.status = "connected";
      this.reconnectAttempts = 0;
      this.emitStatus();
      console.info("[ripple-desktop] socket connected");
    });

    this.socket.on("disconnect", (reason) => {
      console.warn("[ripple-desktop] socket disconnected:", reason);
      if (this.token) {
        this.scheduleReconnect();
      } else {
        this.status = "disconnected";
        this.emitStatus();
      }
    });

    this.socket.on("connect_error", (err) => {
      console.error("[ripple-desktop] socket connect_error:", err.message);
      if (this.token && !this.socket?.connected) {
        this.scheduleReconnect();
      }
    });

    this.socket.on("voice:transcript", (msg) => {
      this.broadcast("voice:transcript", msg);
    });

    this.socket.on("voice:partial_transcript", (msg) => {
      this.broadcast("voice:partial_transcript", msg);
      // P7.8 — progressive insert in main (don't wait for overlay UI).
      void this.handlePartialTranscript(msg);
    });

    this.socket.on("command:result", (msg) => {
      this.broadcast("command:result", msg);
    });

    this.socket.on("socket:error", (msg) => {
      this.broadcast("socket:error", msg);
    });
  }

  async connect(accessToken: string): Promise<void> {
    this.token = accessToken;
    this.clearReconnectTimer();
    this.socket?.removeAllListeners();
    this.socket?.disconnect();

    this.status = "connecting";
    this.emitStatus();

    const url = getSocketUrl();
    console.info(`[ripple-desktop] socket connecting to ${url}`);

    this.socket = io(url, {
      auth: { token: accessToken },
      transports: ["websocket", "polling"],
      reconnection: false,
    });

    this.attachSocketListeners();

    return new Promise((resolve) => {
      if (!this.socket) {
        resolve();
        return;
      }
      const onConnect = () => {
        this.socket?.off("connect_error", onError);
        resolve();
      };
      const onError = () => {
        this.socket?.off("connect", onConnect);
        resolve();
      };
      this.socket.once("connect", onConnect);
      this.socket.once("connect_error", onError);
    });
  }

  disconnect(clearToken = true): void {
    this.clearReconnectTimer();
    if (clearToken) this.token = null;
    this.reconnectAttempts = 0;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.status = "disconnected";
    this.emitStatus();
  }

  private ensureSocket(): Socket {
    if (!this.socket?.connected) {
      throw new Error("Socket not connected");
    }
    return this.socket;
  }

  private async emitWithAck<T extends SocketAck>(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<T> {
    const socket = this.ensureSocket();
    const res = (await socket.timeout(180_000).emitWithAck(event, payload)) as T;
    if (res.success === false) {
      const msg =
        typeof res.message === "string" ? res.message : "Socket request failed";
      throw new Error(msg);
    }
    return res;
  }

  private async handlePartialTranscript(msg: unknown): Promise<void> {
    try {
      const root = msg as {
        success?: boolean;
        data?: { text?: string; stream_id?: string; streamId?: string };
        text?: string;
        stream_id?: string;
        streamId?: string;
      };
      const data = root?.data ?? root;
      const text =
        typeof data?.text === "string"
          ? data.text
          : typeof root?.text === "string"
            ? root.text
            : "";
      const streamId =
        (typeof data?.stream_id === "string" && data.stream_id) ||
        (typeof data?.streamId === "string" && data.streamId) ||
        (typeof root?.stream_id === "string" && root.stream_id) ||
        "";
      if (!text.trim() || !streamId) return;
      const { applyStreamingPartial } = await import(
        "../agent/dictation/streamingInsert.js"
      );
      await applyStreamingPartial({ streamId, text });
    } catch (e: unknown) {
      console.warn(
        "[ripple-stream] partial handler error:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  async sendVoiceChunk(input: VoiceChunkInput): Promise<{
    stream_id: string;
    received_bytes: number;
    total_bytes: number;
  }> {
    const streamId = input.streamId ?? randomUUID();
    const res = await this.emitWithAck<{
      success: true;
      data: { stream_id: string; received_bytes: number; total_bytes: number };
    }>("voice:chunk", {
      stream_id: streamId,
      session_id: input.sessionId,
      chunk: input.chunk,
      mime_type: input.mimeType ?? "audio/webm",
      filename: input.filename ?? "voice.webm",
      is_final: input.isFinal ?? false,
    });
    return res.data;
  }

  async flushVoice(
    streamId: string,
    sessionId?: string,
    language?: string,
  ): Promise<unknown> {
    const res = await this.emitWithAck<{ success: true; data: unknown }>(
      "voice:flush",
      {
        stream_id: streamId,
        session_id: sessionId,
        upload_audio: false,
        language,
      },
    );
    // Backend emitOrAck only acks when a callback is present — it does not
    // also emit voice:partial_transcript. Apply progressive insert from the
    // ack payload here so live typing works.
    //
    // Bug fix (7.8 finalization) — this used to be fire-and-forget
    // ("void this.handlePartialTranscript(...)"). stopRecording's final
    // flush-before-endVoice call awaits flushVoice(), but a fire-and-forget
    // insert wasn't covered by that await: executeDictation.ts's
    // takeStreamingProvisional()+reconcile could then run concurrently with
    // a still-in-flight progressive keystroke insert from this same final
    // flush, risking extra characters typed into the field after the
    // reconciled final text landed. Awaiting here means the caller's await
    // on flushVoice() genuinely waits for any resulting insert to finish.
    const data = res.data as { text?: string; stream_id?: string } | undefined;
    if (data?.text?.trim()) {
      await this.handlePartialTranscript({
        success: true,
        data: { text: data.text, stream_id: data.stream_id ?? streamId },
      });
    }
    return res.data;
  }

  async endVoice(
    streamId: string,
    sessionId?: string,
    language?: string,
    dictationClean?: boolean,
  ): Promise<unknown> {
    const res = await this.emitWithAck<{ success: true; data: unknown }>(
      "voice:end",
      {
        stream_id: streamId,
        session_id: sessionId,
        upload_audio: false,
        language,
        dictation_clean: dictationClean === true,
      },
    );
    return res.data;
  }

  async cancelVoice(streamId: string): Promise<void> {
    await this.emitWithAck("voice:cancel", { stream_id: streamId });
  }

  async executeCommand(input: CommandExecuteInput): Promise<unknown> {
    const res = await this.emitWithAck<{ success: true; data: unknown }>(
      "command:execute",
      {
        session_id: input.sessionId,
        command: input.command,
        context_type: input.contextType ?? "general",
        action_source: input.actionSource ?? "desktop",
        context_metadata: input.contextMetadata,
        selected_text: input.selectedText ?? null,
      },
    );
    return res.data;
  }

  async sendActionAck(payload: {
    command_id: string;
    action_index: number;
    status: "executed" | "failed";
    error?: string;
  }): Promise<void> {
    await this.emitWithAck("command:action_ack", payload);
    console.info(
      `[ripple-desktop] action_ack index=${payload.action_index} status=${payload.status}`,
    );
  }
}

export const rippleSocket = new RippleSocketManager();
