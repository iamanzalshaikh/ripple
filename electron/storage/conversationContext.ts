import { getRippleDb } from "./rippleDb.js";
import { getLastCommandContext } from "./lastCommandState.js";
import {
  getLastCommandIntent,
  getLastVoiceCommand,
} from "../state/lastCommand.js";
import type { DesktopIntentSession } from "../automation/voice/nlu/llmIntent.js";

export type TurnOutcome =
  | "success"
  | "error"
  | "blocked"
  | "not_found"
  | "cancel";

export type ConversationTurn = {
  id: number;
  command: string;
  intent: string | null;
  resolved_path: string | null;
  entities_json: string | null;
  outcome: TurnOutcome;
  created_at: string;
};

const MAX_TURNS = 20;

export function recordConversationTurn(args: {
  command: string;
  intent?: string | null;
  resolved_path?: string | null;
  entities_json?: string | null;
  outcome: TurnOutcome;
}): void {
  const db = getRippleDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversation_turn (command, intent, resolved_path, entities_json, outcome, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    args.command.trim(),
    args.intent?.trim() || null,
    args.resolved_path?.trim() || null,
    args.entities_json ?? null,
    args.outcome,
    now,
  );

  const excess = db
    .prepare(`SELECT id FROM conversation_turn ORDER BY id DESC LIMIT -1 OFFSET ?`)
    .all(MAX_TURNS) as { id: number }[];
  if (excess.length > 0) {
    const ids = excess.map((r) => r.id).join(",");
    db.exec(`DELETE FROM conversation_turn WHERE id IN (${ids})`);
  }
}

export function getRecentConversationTurns(
  limit = 5,
): ConversationTurn[] {
  const db = getRippleDb();
  return db
    .prepare(
      `SELECT id, command, intent, resolved_path, entities_json, outcome, created_at
       FROM conversation_turn ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as ConversationTurn[];
}

/** Session hints for GPT planner — memory keys + recent turn history. */
export function getLlmSessionContext(): DesktopIntentSession {
  const ctx = getLastCommandContext();
  const recent = getRecentConversationTurns(3);
  const lastTurn = recent[0];

  return {
    lastCommand:
      getLastVoiceCommand() ?? lastTurn?.command ?? undefined,
    lastIntent:
      getLastCommandIntent() ?? lastTurn?.intent ?? undefined,
    lastFile: ctx.last_file ?? undefined,
    lastFolder: ctx.last_folder ?? undefined,
    lastContact: ctx.last_contact ?? undefined,
    recentTurns: recent.map((t) => ({
      command: t.command,
      intent: t.intent ?? undefined,
      resolved_path: t.resolved_path ?? undefined,
      outcome: t.outcome,
    })),
  };
}
