/**
 * Phase 10.2 — Meeting Notetaker.
 *
 * Continuous mic capture → chunk transcription (diarized when available) →
 * Flow Note append. On stop: analysis pack (summary, sentiment, decisions,
 * topics, owned action items, talk-time) prepended to the note.
 *
 * Note writes are serialized (mutex) and verified after commit — this path does
 * NOT use the OS insert ladder; silent "said ok but didn't land" is not allowed.
 */

import { randomUUID } from "node:crypto";
import { API_BASE } from "../../services/api.js";
import { getAccessToken } from "../../auth/tokenStore.js";
import { createNote, getNote, updateNote } from "../../storage/notes.js";
import { sendToOverlay } from "../../windows/overlay.js";
import {
  hasMeetingRecordingConsent,
  setMeetingRecordingConsent,
} from "../../storage/userPreferences.js";
import { pushSyncItemAsync } from "../../sync/syncClient.js";

export type MeetingState = "idle" | "recording" | "stopping";

export type MeetingSnapshot = {
  state: MeetingState;
  meetingId: string | null;
  noteId: string | null;
  startedAt: number | null;
  elapsedMs: number;
  lastTranscriptSnippet: string | null;
  transcriptLength: number;
  error: string | null;
  /** Chunks that failed to land in the note (transcribe or write). */
  failedChunks: number;
};

type MeetingSegment = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export type MeetingActionItem = {
  task: string;
  owner: string;
  due: string | null;
  confidence: number;
  evidence: string;
};

export type MeetingAnalysis = {
  summary: string;
  sentiment: {
    overall: string;
    label: string;
    score: number;
    rationale: string;
  };
  decisions: string[];
  openQuestions: string[];
  topics: string[];
  /** Concrete facts (amounts, docs, promises) — not soft paraphrases. */
  keyFacts: string[];
  actionItems: MeetingActionItem[];
  talkTime: Array<{ speaker: string; seconds: number; percent: number }>;
};

type InternalState = {
  state: MeetingState;
  meetingId: string | null;
  noteId: string | null;
  startedAt: number | null;
  /** Full transcript text accumulated (without summary header). */
  transcriptParts: string[];
  lastSnippet: string | null;
  error: string | null;
  failedChunks: number;
  summaryInserted: boolean;
  /** Seconds spoken per speaker label (from diarized segments). */
  speakerSeconds: Map<string, number>;
  diarizedChunks: number;
};

const state: InternalState = {
  state: "idle",
  meetingId: null,
  noteId: null,
  startedAt: null,
  transcriptParts: [],
  lastSnippet: null,
  error: null,
  failedChunks: 0,
  summaryInserted: false,
  speakerSeconds: new Map(),
  diarizedChunks: 0,
};

/** Serialize all note mutations for the active meeting (append vs summary race). */
let noteWriteChain: Promise<void> = Promise.resolve();

function enqueueNoteWrite<T>(fn: () => T): Promise<T> {
  const run = noteWriteChain.then(() => fn());
  noteWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function drainNoteWrites(): Promise<void> {
  await noteWriteChain;
}

function formatMeetingTitle(date = new Date()): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mon = months[date.getMonth()] ?? "Jan";
  const day = date.getDate();
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `Meeting — ${mon} ${day}, ${year} ${hours}:${minutes} ${ampm}`;
}

function formatTimestamp(elapsedMs: number): string {
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function broadcastSnapshot(): void {
  sendToOverlay("overlay:meeting-state", getMeetingState());
}

function pushNoteSync(noteId: string): void {
  const note = getNote(noteId);
  if (!note) return;
  pushSyncItemAsync("note", note.id, {
    title: note.title,
    body: note.body,
    updatedAt: note.updatedAt,
  });
}

/** Keep the open Notes editor in sync with meeting writes (append + analysis). */
function notifyNoteUi(noteId: string, body: string): void {
  try {
    void import("../../windows/mainWindow.js").then(({ getMainWindow }) => {
      getMainWindow()?.webContents.send("notes:bodyAppended", {
        noteId,
        body,
      });
    });
  } catch {
    /* best-effort */
  }
}

function accumulateSpeakerTime(segments: MeetingSegment[]): void {
  for (const seg of segments) {
    const dur = Math.max(0, (seg.end ?? 0) - (seg.start ?? 0));
    if (dur <= 0 && !seg.text) continue;
    const seconds =
      dur > 0 ? dur : Math.max(1, seg.text.split(/\s+/).length * 0.35);
    const prev = state.speakerSeconds.get(seg.speaker) ?? 0;
    state.speakerSeconds.set(seg.speaker, prev + seconds);
  }
}

export function computeTalkTime(
  speakerSeconds: Map<string, number> | Record<string, number>,
): Array<{ speaker: string; seconds: number; percent: number }> {
  const entries =
    speakerSeconds instanceof Map
      ? [...speakerSeconds.entries()]
      : Object.entries(speakerSeconds);
  const total = entries.reduce((sum, [, s]) => sum + s, 0);
  if (total <= 0) return [];
  return entries
    .map(([speaker, seconds]) => ({
      speaker,
      seconds: Math.round(seconds * 10) / 10,
      percent: Math.round((seconds / total) * 1000) / 10,
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

function bulletList(items: string[], empty = "- (none)"): string {
  if (!items.length) return empty;
  return items.map((i) => `- ${i}`).join("\n");
}

function formatConfidence(n: number): string {
  const pct = Math.round(clamp01(n) * 100);
  if (pct >= 75) return `high (${pct}%)`;
  if (pct >= 45) return `medium (${pct}%)`;
  return `low (${pct}%)`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** Exported for unit tests — builds the analysis markdown prepended to notes. */
export function buildMeetingAnalysisBlock(analysis: MeetingAnalysis): string {
  const parts: string[] = [];

  parts.push(`## Summary\n\n${analysis.summary.trim() || "_(empty)_"}\n`);

  const sent = analysis.sentiment;
  parts.push(
    `## Sentiment\n\n` +
      `- **Overall:** ${sent.label || sent.overall}` +
      ` (${sent.overall}, score ${clamp01(sent.score).toFixed(2)})\n` +
      (sent.rationale ? `- **Why:** ${sent.rationale}\n` : ""),
  );

  parts.push(`## Decisions\n\n${bulletList(analysis.decisions)}\n`);

  if (analysis.keyFacts?.length) {
    parts.push(`## Key facts\n\n${bulletList(analysis.keyFacts)}\n`);
  }

  const actions =
    analysis.actionItems.length > 0
      ? analysis.actionItems
          .map((a) => {
            const meta = [
              `owner: ${a.owner || "Unknown"}`,
              a.due ? `due: ${a.due}` : null,
              `confidence: ${formatConfidence(a.confidence)}`,
            ]
              .filter(Boolean)
              .join(" · ");
            const evidence = a.evidence ? `\n  _Evidence: ${a.evidence}_` : "";
            return `- ${a.task}  \n  (${meta})${evidence}`;
          })
          .join("\n")
      : "- (none captured)";
  parts.push(`## Action items\n\n${actions}\n`);

  parts.push(`## Open questions\n\n${bulletList(analysis.openQuestions)}\n`);

  parts.push(
    `## Key topics\n\n${
      analysis.topics.length
        ? analysis.topics.map((t) => `\`${t}\``).join(" · ")
        : "_(none)_"
    }\n`,
  );

  if (analysis.talkTime.length > 0) {
    const rows = analysis.talkTime
      .map(
        (t) =>
          `- **${t.speaker}:** ${t.percent}% (${t.seconds.toFixed(1)}s)`,
      )
      .join("\n");
    parts.push(`## Talk time\n\n${rows}\n`);
  }

  return `${parts.join("\n")}\n`;
}

async function appendTranscriptLineVerified(
  noteId: string,
  line: string,
): Promise<{ ok: boolean; message?: string }> {
  return enqueueNoteWrite(() => {
    const note = getNote(noteId);
    if (!note) {
      console.warn(
        `[ripple-meeting] note_missing on append note=${noteId.slice(0, 8)}`,
      );
      return { ok: false, message: "note_missing" };
    }
    const nextBody = `${note.body.trimEnd()}\n${line}\n`;
    updateNote(noteId, { body: nextBody });
    const verify = getNote(noteId);
    if (!verify || !verify.body.includes(line)) {
      console.warn(
        `[ripple-meeting] note_verify_failed append note=${noteId.slice(0, 8)}`,
      );
      return { ok: false, message: "note_verify_failed" };
    }
    pushNoteSync(noteId);
    notifyNoteUi(noteId, verify.body);
    return { ok: true };
  });
}

async function prependSummaryVerified(
  noteId: string,
  meetingId: string | null,
  summaryBlock: string,
): Promise<{ ok: boolean; message?: string }> {
  return enqueueNoteWrite(() => {
    const note = getNote(noteId);
    if (!note) return { ok: false, message: "note_missing" };
    const body = note.body;
    if (/^## Summary\b/m.test(body) || /\n## Summary\b/.test(body)) {
      console.info(
        `[ripple-meeting] summary already present — skipping prepend`,
      );
      return { ok: true };
    }
    const marker = meetingId ? `<!-- meeting:${meetingId} -->` : null;
    let nextBody: string;
    if (marker && body.includes(marker)) {
      nextBody = body.replace(marker, `${marker}\n\n${summaryBlock.trim()}\n`);
    } else {
      nextBody = `${summaryBlock.trim()}\n\n${body}`;
    }
    updateNote(noteId, { body: nextBody });
    const verify = getNote(noteId);
    if (!verify || !verify.body.includes("## Summary")) {
      console.warn(
        `[ripple-meeting] note_verify_failed summary note=${noteId.slice(0, 8)}`,
      );
      return { ok: false, message: "note_verify_failed" };
    }
    pushNoteSync(noteId);
    notifyNoteUi(noteId, verify.body);
    console.info(
      `[ripple-meeting] analysis prepended note=${noteId.slice(0, 8)} chars=${verify.body.length}`,
    );
    return { ok: true };
  });
}

export function getMeetingState(): MeetingSnapshot {
  const elapsedMs =
    state.state !== "idle" && state.startedAt
      ? Date.now() - state.startedAt
      : 0;
  return {
    state: state.state,
    meetingId: state.meetingId,
    noteId: state.noteId,
    startedAt: state.startedAt,
    elapsedMs,
    lastTranscriptSnippet: state.lastSnippet,
    transcriptLength: state.transcriptParts.join("\n").length,
    error: state.error,
    failedChunks: state.failedChunks,
  };
}

export function isMeetingRecording(): boolean {
  return state.state === "recording" || state.state === "stopping";
}

export function getMeetingConsentStatus(): {
  consented: boolean;
} {
  return { consented: hasMeetingRecordingConsent() };
}

/** Used by overlay meeting hotkey — must stay a boolean function. */
export function isMeetingConsentGranted(): boolean {
  return hasMeetingRecordingConsent();
}

export function grantMeetingConsent(): { ok: true } {
  setMeetingRecordingConsent(true);
  return { ok: true };
}

export function acceptMeetingConsent(): void {
  setMeetingRecordingConsent(true);
}

export function declineMeetingConsent(): void {
  setMeetingRecordingConsent(false);
}

/**
 * Begin a meeting: create the Flow Note and move to recording.
 * Mic capture is started by the Overlay (renderer) after this returns.
 * Caller must ensure consent was granted (see handleMeetingShortcutPress).
 */
export async function startMeetingRecording(): Promise<MeetingSnapshot> {
  if (state.state === "recording" || state.state === "stopping") {
    return getMeetingState();
  }

  if (!hasMeetingRecordingConsent()) {
    state.error = "meeting_consent_required";
    broadcastSnapshot();
    throw new Error("meeting_consent_required");
  }

  const meetingId = randomUUID();
  const title = formatMeetingTitle();
  const header = `<!-- meeting:${meetingId} -->\n\n## Transcript\n\n`;
  const note = createNote({ title, body: header });

  // Verify create landed.
  const created = getNote(note.id);
  if (!created || !created.body.includes(`<!-- meeting:${meetingId} -->`)) {
    throw new Error("meeting_note_create_failed");
  }

  state.state = "recording";
  state.meetingId = meetingId;
  state.noteId = note.id;
  state.startedAt = Date.now();
  state.transcriptParts = [];
  state.lastSnippet = null;
  state.error = null;
  state.failedChunks = 0;
  state.summaryInserted = false;
  state.speakerSeconds = new Map();
  state.diarizedChunks = 0;
  noteWriteChain = Promise.resolve();

  void import("../../state/activeNoteFocus.js").then(({ setActiveNoteId }) => {
    setActiveNoteId(note.id);
  });

  void import("../../windows/mainWindow.js").then(
    ({ showMainWindow, getMainWindow }) => {
      showMainWindow();
      getMainWindow()?.webContents.send("notes:quickCapture", {
        noteId: note.id,
      });
    },
  );

  pushNoteSync(note.id);

  void import("../../tray/index.js").then(({ setMeetingRecordingTray }) => {
    setMeetingRecordingTray(true);
  });

  console.info(
    `[ripple-meeting] started meeting=${meetingId.slice(0, 8)} note=${note.id.slice(0, 8)}`,
  );

  broadcastSnapshot();
  sendToOverlay("overlay:meeting-toggle", { action: "start" });
  return getMeetingState();
}

/**
 * Transcribe one audio chunk and append to the meeting note.
 */
export async function appendMeetingChunk(args: {
  buffer: ArrayBuffer | Buffer | Uint8Array;
  mimeType?: string;
  filename?: string;
}): Promise<{ ok: boolean; text?: string; message?: string }> {
  if (
    (state.state !== "recording" && state.state !== "stopping") ||
    !state.noteId ||
    !state.startedAt
  ) {
    return { ok: false, message: "not_recording" };
  }

  const noteId = state.noteId;
  const accessToken = await getAccessToken().catch(() => null);
  if (!accessToken) {
    state.error = "Sign in to transcribe meeting audio";
    state.failedChunks += 1;
    broadcastSnapshot();
    return { ok: false, message: "not_authenticated" };
  }

  const elapsedMs = Date.now() - state.startedAt;
  const stamp = formatTimestamp(elapsedMs);

  try {
    const bytes =
      args.buffer instanceof ArrayBuffer
        ? new Uint8Array(args.buffer)
        : args.buffer instanceof Buffer
          ? new Uint8Array(args.buffer)
          : args.buffer;
    if (!bytes.byteLength) {
      return { ok: true, text: "" };
    }

    const mimeType = args.mimeType || "audio/webm";
    const filename = args.filename || "meeting-chunk.webm";
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([ab], { type: mimeType });
    const form = new FormData();
    form.append("audio", blob, filename);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    const res = await fetch(`${API_BASE}/voice/meeting/transcribe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
      signal: ac.signal,
    });
    clearTimeout(timer);

    const body = (await res.json()) as {
      success?: boolean;
      data?: {
        text?: string;
        diarized?: boolean;
        model?: string;
        segments?: MeetingSegment[];
      };
      message?: string;
    };
    const text = body.data?.text?.trim() ?? "";
    const segments = Array.isArray(body.data?.segments)
      ? body.data!.segments!
      : [];
    if (!res.ok || !body.success) {
      console.warn(
        `[ripple-meeting] chunk transcribe failed: ${body.message ?? res.status}`,
      );
      state.failedChunks += 1;
      state.error = body.message ?? `HTTP ${res.status}`;
      broadcastSnapshot();
      return { ok: false, message: body.message ?? `HTTP ${res.status}` };
    }
    if (!text && segments.length === 0) {
      return { ok: true, text: "" };
    }

    if (segments.length > 0) {
      state.diarizedChunks += 1;
      accumulateSpeakerTime(segments);
    }

    const chunkEnd = Math.max(
      0,
      ...segments.map((s) => (typeof s.end === "number" ? s.end : 0)),
    );
    const line =
      segments.length > 0
        ? segments
            .map((seg) => {
              const localMs =
                elapsedMs - Math.max(0, chunkEnd - (seg.start ?? 0)) * 1000;
              return `[${formatTimestamp(localMs)}] ${seg.speaker}: ${seg.text}`;
            })
            .join("\n")
        : `[${stamp}] ${text}`;

    state.transcriptParts.push(line);
    state.lastSnippet = (segments[0]?.text ?? text).slice(0, 120);

    const write = await appendTranscriptLineVerified(noteId, line);
    if (!write.ok) {
      state.failedChunks += 1;
      state.error = write.message ?? "note_write_failed";
      broadcastSnapshot();
      return { ok: false, message: write.message, text: line };
    }

    console.info(
      `[ripple-meeting] chunk ok t=${stamp} len=${line.length}` +
        ` diarized=${body.data?.diarized === true} speakers=${segments.length}` +
        ` model=${body.data?.model ?? "?"}`,
    );
    broadcastSnapshot();
    return { ok: true, text: line };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "transcribe_failed";
    console.warn(`[ripple-meeting] chunk error: ${msg}`);
    state.failedChunks += 1;
    state.error = msg;
    broadcastSnapshot();
    return { ok: false, message: msg };
  }
}

async function summarizeTranscript(
  transcript: string,
  talkTime: MeetingAnalysis["talkTime"],
): Promise<MeetingAnalysis | null> {
  const accessToken = await getAccessToken().catch(() => null);
  if (!accessToken || !transcript.trim()) return null;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    const res = await fetch(`${API_BASE}/voice/meeting/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcript, talkTime }),
      signal: ac.signal,
    });
    clearTimeout(timer);

    const body = (await res.json()) as {
      success?: boolean;
      data?: Partial<MeetingAnalysis> & {
        actionItems?: Array<Partial<MeetingActionItem> | string>;
      };
      message?: string;
    };
    if (!res.ok || !body.success || !body.data?.summary) {
      console.warn(
        `[ripple-meeting] summarize failed: ${body.message ?? res.status}`,
      );
      return null;
    }

    const d = body.data;
    const actionItems: MeetingActionItem[] = Array.isArray(d.actionItems)
      ? d.actionItems
          .map((item) => {
            if (typeof item === "string") {
              return {
                task: item.trim(),
                owner: "Unknown",
                due: null,
                confidence: 0.5,
                evidence: "",
              };
            }
            return {
              task: String(item.task ?? "").trim(),
              owner: String(item.owner ?? "Unknown").trim() || "Unknown",
              due: item.due ? String(item.due) : null,
              confidence: clamp01(Number(item.confidence ?? 0.5)),
              evidence: String(item.evidence ?? "").trim(),
            };
          })
          .filter((a) => a.task)
      : [];

    return {
      summary: String(d.summary).trim(),
      sentiment: {
        overall: String(d.sentiment?.overall ?? "neutral"),
        label: String(d.sentiment?.label ?? d.sentiment?.overall ?? "Neutral"),
        score: clamp01(Number(d.sentiment?.score ?? 0.5)),
        rationale: String(d.sentiment?.rationale ?? "").trim(),
      },
      decisions: Array.isArray(d.decisions)
        ? d.decisions.map((x) => String(x).trim()).filter(Boolean)
        : [],
      openQuestions: Array.isArray(d.openQuestions)
        ? d.openQuestions.map((x) => String(x).trim()).filter(Boolean)
        : [],
      topics: Array.isArray(d.topics)
        ? d.topics.map((x) => String(x).trim()).filter(Boolean)
        : [],
      keyFacts: Array.isArray(d.keyFacts)
        ? d.keyFacts.map((x) => String(x).trim()).filter(Boolean)
        : [],
      actionItems,
      talkTime:
        Array.isArray(d.talkTime) && d.talkTime.length > 0
          ? d.talkTime
          : talkTime,
    };
  } catch (e: unknown) {
    console.warn(
      `[ripple-meeting] summarize error:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Stop meeting: flush final audio, drain pending note writes, then summarize.
 */
export async function stopMeetingRecording(options?: {
  finalChunk?: {
    buffer: ArrayBuffer | Buffer | Uint8Array;
    mimeType?: string;
    filename?: string;
  };
}): Promise<MeetingSnapshot> {
  if (state.state !== "recording" && state.state !== "stopping") {
    return getMeetingState();
  }

  state.state = "stopping";
  broadcastSnapshot();

  if (options?.finalChunk) {
    await appendMeetingChunk(options.finalChunk);
  }

  // Wait for any in-flight appends before summary prepend (race fix).
  await drainNoteWrites();

  const transcript = state.transcriptParts.join("\n");
  const noteId = state.noteId;
  const meetingId = state.meetingId;
  const failedChunks = state.failedChunks;
  const talkTime = computeTalkTime(state.speakerSeconds);
  const diarizedChunks = state.diarizedChunks;

  let summaryBlock = "";
  if (transcript.trim()) {
    const result = await summarizeTranscript(transcript, talkTime);
    if (result) {
      summaryBlock = buildMeetingAnalysisBlock(result);
    } else if (talkTime.length > 0) {
      summaryBlock = buildMeetingAnalysisBlock({
        summary:
          "_(LLM summary unavailable — talk-time from diarization only.)_",
        sentiment: {
          overall: "neutral",
          label: "Unknown",
          score: 0.5,
          rationale: "",
        },
        decisions: [],
        openQuestions: [],
        topics: [],
        keyFacts: [],
        actionItems: [],
        talkTime,
      });
    } else {
      summaryBlock = `## Summary\n\n_(Summary unavailable — check connection and try again later.)_\n\n`;
    }
  } else {
    summaryBlock = `## Summary\n\n_(No speech captured.)_\n\n`;
  }

  if (failedChunks > 0 || (diarizedChunks === 0 && transcript.trim())) {
    const notes: string[] = [];
    if (failedChunks > 0) {
      notes.push(
        `${failedChunks} audio chunk(s) failed to transcribe or save — some speech may be missing.`,
      );
    }
    if (diarizedChunks === 0 && transcript.trim()) {
      notes.push(
        "Speaker diarization was unavailable for this session — transcript has no Speaker labels; talk-time omitted.",
      );
    }
    summaryBlock += `## Recording notes\n\n_${notes.join(" ")}_\n\n`;
  }

  if (noteId) {
    const write = await prependSummaryVerified(noteId, meetingId, summaryBlock);
    if (!write.ok) {
      console.warn(
        `[ripple-meeting] summary write failed: ${write.message ?? "unknown"}`,
      );
      state.error = write.message ?? "summary_write_failed";
    } else {
      state.summaryInserted = true;
    }
  }

  console.info(
    `[ripple-meeting] stopped meeting=${meetingId?.slice(0, 8) ?? "?"} ` +
      `transcriptChars=${transcript.length} failedChunks=${failedChunks} ` +
      `diarizedChunks=${diarizedChunks} speakers=${talkTime.length} ` +
      `note=${noteId?.slice(0, 8) ?? "?"}`,
  );

  void import("../../tray/index.js").then(({ setMeetingRecordingTray }) => {
    setMeetingRecordingTray(false);
  });

  state.state = "idle";
  state.meetingId = null;
  state.noteId = null;
  state.startedAt = null;
  state.transcriptParts = [];
  state.lastSnippet = null;
  state.speakerSeconds = new Map();
  state.diarizedChunks = 0;
  const lastError = state.error;
  state.error = null;
  state.failedChunks = 0;
  state.summaryInserted = false;

  broadcastSnapshot();
  if (lastError) {
    sendToOverlay("overlay:state", "error");
    sendToOverlay("overlay:transform-hint", {
      message: "Meeting saved with errors — check note",
    });
  } else {
    sendToOverlay("overlay:state", "result");
  }
  setTimeout(() => {
    sendToOverlay("overlay:state", "idle");
  }, 2200);

  return getMeetingState();
}

/** Toggle start/stop. Stop path signals the Overlay to flush, then finalize via meeting:end. */
export async function toggleMeetingRecording(): Promise<MeetingSnapshot> {
  if (state.state === "recording") {
    sendToOverlay("overlay:meeting-toggle", { action: "stop" });
    return getMeetingState();
  }
  if (state.state === "stopping") {
    return getMeetingState();
  }
  return startMeetingRecording();
}

/** Match voice phrases for start/stop meeting. */
export function parseMeetingVoiceCommand(
  command: string,
): "start" | "stop" | null {
  const t = command.trim().toLowerCase().replace(/[.,!?]+$/g, "");
  if (
    /^(start|begin|record)\s+(a\s+)?(meeting|notetaker|notes?)$/.test(t) ||
    /^(start|begin)\s+meeting\s+(notes?|notetaker)$/.test(t) ||
    t === "start meeting" ||
    t === "begin meeting" ||
    t === "record meeting"
  ) {
    return "start";
  }
  if (
    /^(stop|end|finish|cancel)\s+(the\s+)?(meeting|notetaker|recording)$/.test(
      t,
    ) ||
    t === "stop meeting" ||
    t === "end meeting" ||
    t === "finish meeting"
  ) {
    return "stop";
  }
  return null;
}
